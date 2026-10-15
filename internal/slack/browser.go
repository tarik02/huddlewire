// Package slack drives the Slack desktop app through its Chrome DevTools endpoint.
package slack

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/chromedp/cdproto/target"
	"github.com/chromedp/chromedp"
	"github.com/chromedp/chromedp/remote"
	"go.uber.org/zap"
)

// attachTimeout bounds attaching to a page, which happens outside the caller's
// context because the page connection outlives it.
const attachTimeout = 10 * time.Second

// Browser tracks the DevTools sessions with Slack's pages. It is not safe for
// concurrent use.
type Browser struct {
	log         *zap.Logger
	ctx         context.Context
	cancel      context.CancelFunc
	allocCancel context.CancelFunc
	pages       map[target.ID]*Page
}

// Page is one Slack window: the main client or the huddle popup.
type Page struct {
	URL string

	ctx           context.Context
	cancel        context.CancelFunc
	muteObserving bool
}

// Connect opens a DevTools connection to Slack. cdpURL is the HTTP endpoint,
// such as http://127.0.0.1:9224.
func Connect(log *zap.Logger, cdpURL string) (*Browser, error) {
	// The connection lives until Close, so it does not derive from a
	// caller's context; the dial has its own timeout.
	allocCtx, allocCancel := remote.NewAllocator(context.Background(), cdpURL)
	ctx, cancel := chromedp.NewContext(allocCtx, chromedp.WithDetachOnCancel())

	// Listing targets connects to the browser without opening a tab, which
	// Slack refuses.
	if _, err := chromedp.Targets(ctx); err != nil {
		cancel()
		allocCancel()
		return nil, fmt.Errorf("connect to Slack DevTools at %s: %w", cdpURL, err)
	}
	return &Browser{
		log:         log,
		ctx:         ctx,
		cancel:      cancel,
		allocCancel: allocCancel,
		pages:       map[target.ID]*Page{},
	}, nil
}

// Close detaches from every page and disconnects. Slack keeps running.
func (b *Browser) Close() {
	for id, page := range b.pages {
		page.cancel()
		delete(b.pages, id)
	}
	b.cancel()
	b.allocCancel()
}

// Pages returns the Slack client and huddle pages. The huddle popup reports
// about:blank as its URL.
func (b *Browser) Pages(ctx context.Context) ([]*Page, error) {
	ctx, done := withCaller(b.ctx, ctx)
	defer done()
	infos, err := chromedp.Targets(ctx)
	if err != nil {
		return nil, fmt.Errorf("list Slack pages: %w", err)
	}

	var pages []*Page
	seen := map[target.ID]bool{}
	for _, info := range infos {
		if info.Type != "page" || !isSlackPage(info.URL) {
			continue
		}
		seen[info.TargetID] = true

		page, ok := b.pages[info.TargetID]
		if ok && page.Closed() {
			page.cancel()
			delete(b.pages, info.TargetID)
			ok = false
		}
		if !ok {
			page, err = b.attach(info.TargetID)
			if err != nil {
				// The page may have closed after it was listed.
				b.log.Warn("attach to Slack page", zap.String("url", info.URL), zap.Error(err))
				continue
			}
			b.pages[info.TargetID] = page
		}
		page.URL = info.URL
		pages = append(pages, page)
	}

	for id, page := range b.pages {
		if !seen[id] {
			page.cancel()
			delete(b.pages, id)
		}
	}
	return pages, nil
}

func (b *Browser) attach(id target.ID) (*Page, error) {
	// Without WithDetachOnCancel, cancelling the context closes the Slack
	// window.
	ctx, cancel := chromedp.NewContext(b.ctx, chromedp.WithTargetID(id), chromedp.WithDetachOnCancel())

	// The first action binds the page session to its context, so it cannot
	// carry a timeout; cancel the page instead if attaching hangs.
	attached := make(chan error, 1)
	go func() {
		attached <- chromedp.Do(ctx)
	}()
	select {
	case err := <-attached:
		if err != nil {
			cancel()
			return nil, err
		}
	case <-time.After(attachTimeout):
		cancel()
		return nil, errors.New("timed out attaching")
	}
	return &Page{ctx: ctx, cancel: cancel}, nil
}

func isSlackPage(url string) bool {
	return strings.HasPrefix(url, "https://app.slack.com/client/") || url == "about:blank"
}

// withCaller returns a context with the chromedp values of session that also
// ends when caller ends. Call the returned func once done.
func withCaller(session, caller context.Context) (context.Context, func()) {
	ctx, cancel := context.WithCancelCause(session)
	stop := context.AfterFunc(caller, func() {
		cancel(context.Cause(caller))
	})
	return ctx, func() {
		stop()
		cancel(nil)
	}
}

// Closed reports whether the page's DevTools session is gone.
func (p *Page) Closed() bool {
	return p.ctx.Err() != nil
}

func run[T any](ctx context.Context, p *Page, action chromedp.Action[T]) (T, error) {
	ctx, done := withCaller(p.ctx, ctx)
	defer done()
	return chromedp.Run(ctx, action)
}

// Evaluate runs a JavaScript expression, awaits a returned promise, and decodes
// the JSON result into out unless out is nil.
func (p *Page) Evaluate(ctx context.Context, expression string, out any) error {
	value, err := run(ctx, p, chromedp.Evaluate[[]byte](expression, chromedp.EvalAwaitPromise))
	if err != nil {
		return err
	}
	if out == nil || len(value) == 0 {
		return nil
	}
	return json.Unmarshal(value, out)
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

type point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

var errWaitTimeout = errors.New("timed out waiting for page condition")

// WaitFor polls a JavaScript predicate function until it returns a truthy value
// or timeout passes.
func (p *Page) WaitFor(ctx context.Context, timeout time.Duration, predicate string, args ...any) error {
	_, err := run(ctx, p, chromedp.PollFunction[chromedp.Void](
		predicate,
		chromedp.WithPollingArgs(args...),
		chromedp.WithPollingTimeout(timeout),
		// The default requestAnimationFrame polling stalls in a hidden window.
		chromedp.WithPollingInterval(100*time.Millisecond),
	))
	if errors.Is(err, chromedp.ErrPollingTimeout) {
		return errWaitTimeout
	}
	return err
}

// Click clicks the first element matching a CSS selector once it is visible.
func (p *Page) Click(ctx context.Context, selector string) error {
	_, err := run(ctx, p, chromedp.Click(chromedp.CSS(selector)))
	return err
}

// ClickAt clicks the left mouse button at viewport coordinates.
func (p *Page) ClickAt(ctx context.Context, x, y float64) error {
	_, err := run(ctx, p, chromedp.MouseClickXY(x, y))
	return err
}
