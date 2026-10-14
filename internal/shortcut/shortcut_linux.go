// Package shortcut registers the global mute shortcut.
package shortcut

import (
	"context"
	"fmt"
	"log"
	"slices"

	"github.com/godbus/dbus/v5"
)

// RunOnMainThread runs f. Linux shortcuts have no main-thread requirement.
func RunOnMainThread(f func()) {
	f()
}

const (
	kglobalaccel      = "org.kde.kglobalaccel"
	componentUnique   = "huddlewire"
	shortcutUnique    = "toggleMute"
	qtKeyF24          = 0x01000047
	setPresent        = 0x2
	noAutoloading     = 0x4
	componentIface    = "org.kde.kglobalaccel.Component"
	kglobalaccelIface = "org.kde.KGlobalAccel"
)

// Register binds F24 through KDE's KGlobalAccel and calls toggle when it is
// pressed.
func Register(ctx context.Context, toggle func()) error {
	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		return err
	}
	if err := register(ctx, conn, toggle); err != nil {
		conn.Close()
		return err
	}
	go func() {
		<-ctx.Done()
		conn.Close()
	}()
	return nil
}

func register(ctx context.Context, conn *dbus.Conn, toggle func()) error {
	accel := conn.Object(kglobalaccel, "/kglobalaccel")
	actionID := []string{componentUnique, shortcutUnique, "Huddlewire", "Toggle Slack Huddle mute"}

	var removedLegacy bool
	err := accel.CallWithContext(ctx, kglobalaccelIface+".unregister", 0, "huddlewire-toggle-mute.desktop", "_launch").Store(&removedLegacy)
	if err != nil {
		return err
	}
	if removedLegacy {
		log.Print("removed legacy desktop-launcher mute shortcut")
	}

	if err := accel.CallWithContext(ctx, kglobalaccelIface+".doRegister", 0, actionID).Err; err != nil {
		return err
	}
	var assigned []int32
	err = accel.CallWithContext(ctx, kglobalaccelIface+".setShortcut", 0, actionID, []int32{qtKeyF24}, uint32(setPresent|noAutoloading)).Store(&assigned)
	if err != nil {
		return err
	}
	if !slices.Contains(assigned, qtKeyF24) {
		return fmt.Errorf("KGlobalAccel did not assign F24 (assigned: %v)", assigned)
	}

	var componentPath dbus.ObjectPath
	if err := accel.CallWithContext(ctx, kglobalaccelIface+".getComponent", 0, componentUnique).Store(&componentPath); err != nil {
		return err
	}
	err = conn.AddMatchSignalContext(ctx,
		dbus.WithMatchObjectPath(componentPath),
		dbus.WithMatchInterface(componentIface),
		dbus.WithMatchMember("globalShortcutPressed"),
	)
	if err != nil {
		return err
	}

	signals := make(chan *dbus.Signal, 8)
	conn.Signal(signals)
	go func() {
		for signal := range signals {
			if signal.Name != componentIface+".globalShortcutPressed" || len(signal.Body) < 2 {
				continue
			}
			component, _ := signal.Body[0].(string)
			shortcut, _ := signal.Body[1].(string)
			if component == componentUnique && shortcut == shortcutUnique {
				toggle()
			}
		}
	}()

	log.Print("global mute shortcut registered: F24")
	return nil
}
