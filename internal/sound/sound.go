// Package sound plays the mute feedback sounds in-process.
package sound

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/ebitengine/oto/v3"
	"github.com/hajimehoshi/go-mp3"
)

// Player holds both feedback sounds decoded in memory, so playback starts
// without disk or decoder latency.
type Player struct {
	audio   *oto.Context
	muted   []byte
	unmuted []byte
}

type decoded struct {
	sampleRate int
	pcm        []byte
}

func decode(path string) (decoded, error) {
	file, err := os.Open(path)
	if err != nil {
		return decoded{}, err
	}
	defer file.Close()

	decoder, err := mp3.NewDecoder(file)
	if err != nil {
		return decoded{}, fmt.Errorf("decode %s: %w", path, err)
	}
	pcm, err := io.ReadAll(decoder)
	if err != nil {
		return decoded{}, fmt.Errorf("decode %s: %w", path, err)
	}
	return decoded{sampleRate: decoder.SampleRate(), pcm: pcm}, nil
}

// Load decodes two MP3 files with the same sample rate and opens the audio
// output.
func Load(mutedPath, unmutedPath string) (*Player, error) {
	muted, err := decode(mutedPath)
	if err != nil {
		return nil, err
	}
	unmuted, err := decode(unmutedPath)
	if err != nil {
		return nil, err
	}
	// A process gets one audio context, which has a single sample rate.
	if muted.sampleRate != unmuted.sampleRate {
		return nil, fmt.Errorf("mute sounds have different sample rates: %d Hz and %d Hz", muted.sampleRate, unmuted.sampleRate)
	}

	audio, ready, err := oto.NewContext(&oto.NewContextOptions{
		SampleRate:   muted.sampleRate,
		ChannelCount: 2, // go-mp3 always decodes to stereo
		Format:       oto.FormatSignedInt16LE,
		BufferSize:   20 * time.Millisecond,
	})
	if err != nil {
		return nil, fmt.Errorf("open audio output: %w", err)
	}
	<-ready
	return &Player{audio: audio, muted: muted.pcm, unmuted: unmuted.pcm}, nil
}

// Play starts the sound for the new mute state and returns immediately.
func (p *Player) Play(muted bool) {
	pcm := p.unmuted
	if muted {
		pcm = p.muted
	}
	// The audio context keeps the player alive until it finishes.
	p.audio.NewPlayer(bytes.NewReader(pcm)).Play()
}
