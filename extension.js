const Lang = imports.lang;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;
const Util = imports.misc.util;
const MessageTray = imports.ui.messageTray;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Gettext = imports.gettext.domain('text-scaler');
const _ = Gettext.gettext;
const DEFAULT_VALUE = 75;
const MIN_VALUE = 0;
const MAX_VALUE = 100;
const NUM_DECIMALS = 0;
const TEXT_SCALING_FACTOR_KEY = 'text-scaling-factor';


let brightnessManager = null;

function init() {
    Convenience.initTranslations("text-scaler");
}

function enable() {
    brightnessManager = new BrightnessManager();
    Main.panel.addToStatusArea('brightness-manager', brightnessManager);
}

function disable() {
    brightnessManager.destroy();
}

function normalizeValue(value) {
    return Math.max(MIN_VALUE, Math.min(value, MAX_VALUE));
}

function textScalingToSliderValue(textScaling) {
    return (textScaling - MIN_VALUE) / (MAX_VALUE - MIN_VALUE);
}

function sliderValueToTextScaling(sliderValue) {
    return sliderValue * (MAX_VALUE - MIN_VALUE) + MIN_VALUE;
}

function isDefaultFloatValue(value) {
    return Math.abs(value - DEFAULT_VALUE) < (Math.pow(10, -NUM_DECIMALS) / 2);
}

const BrightnessManager = new Lang.Class({
    Name: 'BrightnessManager',
    Extends: PanelMenu.Button,
    _init: function () {
        this.sliderIsDragging = false;

        this.devices = this.queryDevices();
        this.parent(0.0, "Brightness Manager");
        this.setSensitive(true);

        this.settings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this.settings.connect('changed::text-scaling-factor', Lang.bind(this, this.onSettingsChanged));

        this.currentValue = this.settings.get_double(TEXT_SCALING_FACTOR_KEY);
        this.sliderValue = textScalingToSliderValue(this.currentValue);

        this.hbox = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this.hbox.add_child(new St.Icon({
            style_class: 'system-status-icon',
            icon_name: 'preferences-desktop-multimedia'
        }));
        this.actor.add_child(this.hbox);

        this._menu = new PopupMenu.PopupMenu(this.actor, 0.0, St.Side.BOTTOM);
        this.setMenu(this._menu);

        this.menuItem = new PopupMenu.PopupBaseMenuItem({activate: true});
        this.menuItem.actor.connect('key-press-event', Lang.bind(this, this.onMenuItemKeyPressed));
        this._menu.addMenuItem(this.menuItem);

        this.inputText = new St.Entry({style_class: 'input-text'});
        this.inputText.clutter_text.connect('activate', Lang.bind(this, this.onEntryActivated));
        this.inputText.clutter_text.connect('key-focus-out', Lang.bind(this, this.onEntryKeyFocusOut));
        this.menuItem.actor.add_child(this.inputText);

        this.slider = new Slider.Slider(this.sliderValue);
        this.slider.connect('value-changed', Lang.bind(this, this.onSliderValueChanged));
        this.slider.connect('drag-begin', Lang.bind(this, this.onSliderDragBegan));
        this.slider.connect('drag-end', Lang.bind(this, this.onSliderDragEnded));
        this.slider.actor.x_expand = true;
        this.menuItem.actor.add_actor(this.slider.actor);


        this.separatorItem = new PopupMenu.PopupSeparatorMenuItem();
        this._menu.addMenuItem(this.separatorItem);

        this.resetValueItem = new PopupMenu.PopupMenuItem(_("Reset to default value"));
        this.resetValueItem.connect('activate', Lang.bind(this, this.onResetValueActivate));
        this._menu.addMenuItem(this.resetValueItem);

        this.updateUI();
    },

    onSettingsChanged: function (settings, key) {
        this.updateBrightnessValue(this.settings.get_double(TEXT_SCALING_FACTOR_KEY), false);
    },

    onMenuItemKeyPressed: function (actor, event) {
        return this.slider.onKeyPressEvent(actor, event);
    },

    onEntryActivated: function (entry) {
        this.updateValueFromTextEntry(entry);
    },

    onEntryKeyFocusOut: function (entry) {
        this.updateValueFromTextEntry(entry);
    },

    onSliderValueChanged: function (slider, value) {
        this.sliderValue = value;
        this.updateTextEntry(sliderValueToTextScaling(value));
    },

    onSliderDragBegan: function (slider) {
        this.sliderIsDragging = true;
    },

    onSliderDragEnded: function (slider) {
        let value = sliderValueToTextScaling(slider._getCurrentValue()).toFixed(0);
        this.sliderIsDragging = false;
        this.updateBrightnessValue(value);
    },

    setBrightnessToAllLCD: function (value) {
        for (var i = 0; i < this.devices.length; i++) {
            this.setLCDBrightness(i, value);
        }
    },

    setLCDBrightness: function (deviceIndex, value) {
        var device = this.devices[deviceIndex];
        Util.spawn(['sudo', 'ddccontrol', device, '-r', '0x10', '-w', value]);
    },

    queryDevices: function () {
        var devices = this.executeCommand('sudo ddccontrol -p | grep -i device:');

        devices = devices.replace(/\r?\n|\r| */g, '').replace(/-Device:/g, ',').split(",");
        devices.shift();

        return devices;
    },

    executeCommand: function (command) {
        let output = GLib.spawn_sync(null, ['bash', '-c', command], null, GLib.SpawnFlags.SEARCH_PATH, null);
        return output[0] ? output[1].toString() : "script error";
    },

    onResetValueActivate: function (menuItem, event) {
        this.updateBrightnessValue(DEFAULT_VALUE);
    },

    updateValueFromTextEntry: function (entry) {
        let currentText = entry.get_text();
        let value = parseFloat(currentText);

        if (isFinite(currentText) && !isNaN(currentText) && !isNaN(value)) {
            this.updateBrightnessValue(value);
        }

        this.updateUI();
    },

    updateBrightnessValue: function (value) {
        if (this.currentValue != value && !this.sliderIsDragging) {
            this.currentValue = normalizeValue(value);
            this.updateUI();
            notifyError("dfsdfds","");
        }
    },

    updateUI: function () {
        this.updateTextEntry();
        this.updateSlider();
        this.updateResetValueItem();
    },

    updateTextEntry: function (value=null) {
        let valueToDisplay = (value != null) ? value : this.currentValue;

        this.inputText.set_text(valueToDisplay.toFixed(NUM_DECIMALS));
    },

    updateSlider: function () {
        this.slider.setValue(textScalingToSliderValue(this.currentValue));
    },

    updateResetValueItem: function () {
        this.resetValueItem.setSensitive(!isDefaultFloatValue(this.currentValue));
    }
});

const ExtensionNotificationSource = new Lang.Class({
    Name: 'ExtensionNotificationSource',
    Extends: MessageTray.Source,

    _init: function () {
        this.parent(_("Extension"), 'dialog-warning-symbolic');
    },

    open: function () {
        this.destroy();
    }
});

function notifyError(msg, details) {
    log('error: ' + msg + ': ' + details);
    notify(msg, details);
}

function notify(msg, details) {
    let source = new ExtensionNotificationSource();
    Main.messageTray.add(source);
    let notification = new MessageTray.Notification(source, msg, details);
    if (source.setTransient === undefined)
        notification.setTransient(true);
    else
        source.setTransient(true);
    source.notify(notification);
}
