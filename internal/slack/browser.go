// Package slack drives the Slack desktop app through its Chrome DevTools endpoint.
package slack

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/mafredri/cdp"
	"github.com/mafredri/cdp/devtool"
	"github.com/mafredri/cdp/protocol/input"
	"github.com/mafredri/cdp/protocol/runtime"
	"github.com/mafredri/cdp/rpcc"
)

// Browser tracks the DevTools connections to Slack's pages. It is not safe for
// concurrent use.
type Browser struct {
	devtools *devtool.DevTools
	pages    map[string]*Page
}

// Page is one Slack window: the main client or the huddle popup.
type Page struct {
	URL string

	conn          *rpcc.Conn
	client        *cdp.Client
	muteObserving bool
}

// Connect checks that Slack's DevTools endpoint answers.
func Connect(ctx context.Context, cdpURL string) (*Browser, error) {
	devtools := devtool.New(cdpURL)
	if _, err := devtools.Version(ctx); err != nil {
		return nil, fmt.Errorf("connect to Slack DevTools at %s: %w", cdpURL, err)
	}
	return &Browser{devtools: devtools, pages: map[string]*Page{}}, nil
}

// Close disconnects from every page. Slack itself keeps running.
func (b *Browser) Close() {
	for id, page := range b.pages {
		page.conn.Close()
		delete(b.pages, id)
	}
}

// Pages returns the Slack client and huddle pages in DevTools order. The huddle
// popup reports about:blank as its URL.
func (b *Browser) Pages(ctx context.Context) ([]*Page, error) {
	targets, err := b.devtools.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("list Slack pages: %w", err)
	}

	var pages []*Page
	seen := map[string]bool{}
	for _, target := range targets {
		if target.Type != devtool.Page || !isSlackPage(target.URL) {
			continue
		}
		seen[target.ID] = true

		page, ok := b.pages[target.ID]
		if ok && page.conn.Context().Err() != nil {
			delete(b.pages, target.ID)
			ok = false
		}
		if !ok {
			conn, err := rpcc.DialContext(ctx, target.WebSocketDebuggerURL)
			if err != nil {
				// The page may have closed after it was listed.
				log.Printf("connect to Slack page %s: %v", target.URL, err)
				continue
			}
			page = &Page{conn: conn, client: cdp.NewClient(conn)}
			b.pages[target.ID] = page
		}
		page.URL = target.URL
		pages = append(pages, page)
	}

	for id, page := range b.pages {
		if !seen[id] {
			page.conn.Close()
			delete(b.pages, id)
		}
	}
	return pages, nil
}

func isSlackPage(url string) bool {
	return strings.HasPrefix(url, "https://app.slack.com/client/") || url == "about:blank"
}

// Closed reports whether the page's DevTools connection is gone.
func (p *Page) Closed() bool {
	return p.conn.Context().Err() != nil
}

// Evaluate runs a JavaScript expression, awaits a returned promise, and decodes
// the JSON result into out unless out is nil.
func (p *Page) Evaluate(ctx context.Context, expression string, out any) error {
	reply, err := p.client.Runtime.Evaluate(
		ctx,
		runtime.NewEvaluateArgs(expression).SetReturnByValue(true).SetAwaitPromise(true),
	)
	if err != nil {
		return err
	}
	if reply.ExceptionDetails != nil {
		return fmt.Errorf("page script failed: %w", reply.ExceptionDetails)
	}
	if out == nil || len(reply.Result.Value) == 0 {
		return nil
	}
	return json.Unmarshal(reply.Result.Value, out)
}

// Call evaluates a JavaScript function expression with JSON-encoded arguments.
func (p *Page) Call(ctx context.Context, function string, out any, args ...any) error {
	encoded := make([]string, len(args))
	for i, arg := range args {
		value, err := json.Marshal(arg)
		if err != nil {
			return err
		}
		encoded[i] = string(value)
	}
	return p.Evaluate(ctx, fmt.Sprintf("(%s)(%s)", function, strings.Join(encoded, ", ")), out)
}

var errWaitTimeout = errors.New("timed out waiting for page condition")

// WaitFor polls a JavaScript predicate until it returns true or timeout passes.
func (p *Page) WaitFor(ctx context.Context, timeout time.Duration, predicate string, args ...any) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		var done bool
		if err := p.Call(ctx, predicate, &done, args...); err != nil {
			if ctx.Err() != nil {
				return errWaitTimeout
			}
			return err
		}
		if done {
			return nil
		}
		select {
		case <-ctx.Done():
			return errWaitTimeout
		case <-ticker.C:
		}
	}
}

type point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Click scrolls the first element matching selector into view and clicks its
// center with real mouse events.
func (p *Page) Click(ctx context.Context, selector string) error {
	var center *point
	err := p.Call(ctx, `(selector) => {
		const element = document.querySelector(selector);
		if (!element) {
			return null;
		}
		element.scrollIntoView({ block: 'center', inline: 'center' });
		const rect = element.getBoundingClientRect();
		return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
	}`, &center, selector)
	if err != nil {
		return err
	}
	if center == nil {
		return fmt.Errorf("no element matches %s", selector)
	}
	return p.ClickAt(ctx, center.X, center.Y)
}

// ClickAt clicks the left mouse button at viewport coordinates.
func (p *Page) ClickAt(ctx context.Context, x, y float64) error {
	events := []*input.DispatchMouseEventArgs{
		input.NewDispatchMouseEventArgs("mouseMoved", x, y),
		input.NewDispatchMouseEventArgs("mousePressed", x, y).SetButton(input.MouseButtonLeft).SetClickCount(1),
		input.NewDispatchMouseEventArgs("mouseReleased", x, y).SetButton(input.MouseButtonLeft).SetClickCount(1),
	}
	for _, event := range events {
		if err := p.client.Input.DispatchMouseEvent(ctx, event); err != nil {
			return err
		}
	}
	return nil
}
