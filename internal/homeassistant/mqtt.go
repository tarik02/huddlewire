// Package homeassistant publishes the huddle state to MQTT with Home Assistant
// discovery and receives commands from it.
package homeassistant

import (
	"encoding/json"
	"fmt"
	"log"
	"maps"
	"os"
	"sync"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"

	"github.com/tarik02/huddlewire/internal/config"
	"github.com/tarik02/huddlewire/internal/slack"
)

// Handlers receive commands from Home Assistant. They run on MQTT goroutines.
type Handlers struct {
	OnMute    func(muted bool)
	OnSticker func(sticker string)
}

type topics struct {
	availability string
	state        string
	attributes   string
	mute         string
	muteSet      string
	huddle       string
	sticker      string
	stickerSet   string
}

// Client keeps the broker updated with the latest Slack status.
type Client struct {
	cfg    config.Config
	topics topics
	client paho.Client

	mu         sync.Mutex
	lastStatus *slack.Status
}

// Connect starts connecting to the broker in the background and keeps
// reconnecting until Close.
func Connect(cfg config.Config, handlers Handlers) *Client {
	base := cfg.MQTTBaseTopic
	c := &Client{
		cfg: cfg,
		topics: topics{
			attributes:   base + "/attributes",
			availability: base + "/availability",
			huddle:       base + "/huddle",
			mute:         base + "/mute",
			muteSet:      base + "/mute/set",
			state:        base + "/state",
			sticker:      base + "/sticker",
			stickerSet:   base + "/sticker/set",
		},
	}

	options := paho.NewClientOptions().
		AddBroker(cfg.MQTTURL).
		SetClientID(fmt.Sprintf("%s-%d", config.AppName, os.Getpid())).
		SetUsername(cfg.MQTTUsername).
		SetPassword(cfg.MQTTPassword).
		SetWill(c.topics.availability, "offline", 0, true).
		SetAutoReconnect(true).
		SetConnectRetry(true).
		SetConnectRetryInterval(5 * time.Second).
		SetMaxReconnectInterval(5 * time.Second).
		// Command handlers may wait on Slack; keep them off the router goroutine.
		SetOrderMatters(false).
		SetOnConnectHandler(func(client paho.Client) {
			log.Print("mqtt connected")
			c.onConnect(client, handlers)
		}).
		SetConnectionLostHandler(func(_ paho.Client, err error) {
			log.Printf("mqtt connection lost: %v", err)
		}).
		SetReconnectingHandler(func(paho.Client, *paho.ClientOptions) {
			log.Print("mqtt reconnecting")
		})

	c.client = paho.NewClient(options)
	c.client.Connect()
	return c
}

// Close marks huddlewire offline and disconnects. A clean disconnect does not
// trigger the broker's will message.
func (c *Client) Close() {
	if c.client.IsConnectionOpen() {
		c.client.Publish(c.topics.availability, 0, true, "offline").WaitTimeout(time.Second)
	}
	c.client.Disconnect(250)
}

func (c *Client) onConnect(client paho.Client, handlers Handlers) {
	c.publishDiscovery()
	c.mu.Lock()
	lastStatus := c.lastStatus
	c.mu.Unlock()
	if lastStatus != nil {
		c.publishStatus(*lastStatus)
	}

	subscriptions := map[string]paho.MessageHandler{
		c.cfg.HADiscoveryPrefix + "/status": func(_ paho.Client, message paho.Message) {
			if string(message.Payload()) == "online" {
				c.publishDiscovery()
			}
		},
		c.topics.muteSet: func(_ paho.Client, message paho.Message) {
			switch command := string(message.Payload()); command {
			case "ON":
				handlers.OnMute(true)
			case "OFF":
				handlers.OnMute(false)
			default:
				log.Printf("unknown mute command: %s", command)
			}
		},
		c.topics.stickerSet: func(_ paho.Client, message paho.Message) {
			handlers.OnSticker(string(message.Payload()))
		},
	}
	for topic, handler := range subscriptions {
		token := client.Subscribe(topic, 0, handler)
		go func() {
			if token.Wait(); token.Error() != nil {
				log.Printf("mqtt subscribe to %s failed: %v", topic, token.Error())
			}
		}()
	}
}

func (c *Client) publish(topic string, payload any) {
	var body []byte
	switch value := payload.(type) {
	case string:
		body = []byte(value)
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			log.Printf("encode mqtt payload for %s: %v", topic, err)
			return
		}
		body = encoded
	}

	token := c.client.Publish(topic, 0, true, body)
	go func() {
		if token.Wait(); token.Error() != nil {
			log.Printf("mqtt publish failed for %s: %v", topic, token.Error())
		}
	}()
}

func onOff(value bool) string {
	if value {
		return "ON"
	}
	return "OFF"
}

func (c *Client) publishDiscovery() {
	cfg := c.cfg
	device := map[string]any{
		"identifiers":  []string{cfg.DeviceID},
		"manufacturer": "Slack",
		"name":         cfg.DeviceName,
	}
	origin := map[string]any{
		"name":       config.AppName,
		"sw_version": config.Version,
	}
	entity := func(fields map[string]any) map[string]any {
		fields["availability_topic"] = c.topics.availability
		fields["payload_available"] = "online"
		fields["payload_not_available"] = "offline"
		fields["device"] = device
		fields["origin"] = origin
		fields["json_attributes_topic"] = c.topics.attributes
		return fields
	}

	prefix := cfg.HADiscoveryPrefix + "/"
	suffix := "/" + cfg.DeviceID
	c.publish(prefix+"binary_sensor"+suffix+"/huddle_muted/config", entity(map[string]any{
		"icon":        "mdi:microphone-off",
		"name":        "Huddle muted",
		"payload_off": "OFF",
		"payload_on":  "ON",
		"state_topic": c.topics.mute,
		"unique_id":   cfg.DeviceID + "_huddle_muted",
	}))
	c.publish(prefix+"binary_sensor"+suffix+"/in_huddle/config", entity(map[string]any{
		"icon":        "mdi:phone-in-talk",
		"name":        "In huddle",
		"payload_off": "OFF",
		"payload_on":  "ON",
		"state_topic": c.topics.huddle,
		"unique_id":   cfg.DeviceID + "_in_huddle",
	}))
	c.publish(prefix+"sensor"+suffix+"/huddle_state/config", entity(map[string]any{
		"icon":           "mdi:account-voice",
		"name":           "Huddle state",
		"state_topic":    c.topics.state,
		"unique_id":      cfg.DeviceID + "_huddle_state",
		"value_template": "{{ value_json.huddle_state }}",
	}))
	c.publish(prefix+"switch"+suffix+"/huddle_mute/config", entity(map[string]any{
		"command_topic": c.topics.muteSet,
		"icon":          "mdi:microphone-off",
		"name":          "Huddle mute",
		"optimistic":    false,
		"payload_off":   "OFF",
		"payload_on":    "ON",
		"retain":        false,
		"state_off":     "OFF",
		"state_on":      "ON",
		"state_topic":   c.topics.mute,
		"unique_id":     cfg.DeviceID + "_huddle_mute_switch",
	}))
	c.publish(prefix+"select"+suffix+"/huddle_sticker/config", entity(map[string]any{
		"command_topic": c.topics.stickerSet,
		"icon":          "mdi:sticker-emoji",
		"name":          "Huddle sticker",
		"optimistic":    false,
		"options":       slack.SelectableStickers,
		"retain":        false,
		"state_topic":   c.topics.sticker,
		"unique_id":     cfg.DeviceID + "_huddle_sticker",
	}))
}

// PublishStatus publishes status now, or on the next connect while the broker
// is unreachable.
func (c *Client) PublishStatus(status slack.Status) {
	c.mu.Lock()
	c.lastStatus = &status
	c.mu.Unlock()
	if c.client.IsConnectionOpen() {
		c.publishStatus(status)
	}
}

func (c *Client) publishStatus(status slack.Status) {
	muted := status.InHuddle && status.Muted
	state := map[string]any{
		"huddle_state":         status.HuddleState,
		"in_huddle":            status.InHuddle,
		"muted":                muted,
		"slack_connected":      status.SlackConnected,
		"sticker_action_label": status.StickerActionLabel,
		"sticker_label":        status.StickerLabel,
		"updated_at":           time.Now().UTC().Format("2006-01-02T15:04:05.000Z07:00"),
	}
	attributes := map[string]any{
		"huddle_title":         status.HuddleTitle,
		"mute_label":           status.MuteLabel,
		"page_url":             status.PageURL,
		"source":               status.Source,
		"sticker_action_emoji": status.StickerActionEmoji,
		"sticker_emoji":        status.StickerEmoji,
		"sticker_options":      status.StickerOptions,
	}
	maps.Copy(attributes, state)

	availability := "offline"
	if status.SlackConnected {
		availability = "online"
	}
	sticker := slack.NoSticker
	if status.StickerLabel != nil {
		sticker = *status.StickerLabel
	}

	c.publish(c.topics.attributes, attributes)
	c.publish(c.topics.availability, availability)
	c.publish(c.topics.huddle, onOff(status.InHuddle))
	c.publish(c.topics.mute, onOff(muted))
	c.publish(c.topics.state, state)
	c.publish(c.topics.sticker, sticker)
}
