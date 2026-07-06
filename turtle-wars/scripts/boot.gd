extends Node
## Autoload. Registers the input map in code so project.godot stays free of
## fragile serialized InputEvent blobs. Touch controls live in hud.gd.

const KEY_BINDS := {
	"tw_up": [KEY_W, KEY_UP],
	"tw_down": [KEY_S, KEY_DOWN],
	"tw_left": [KEY_A, KEY_LEFT],
	"tw_right": [KEY_D, KEY_RIGHT],
	"tw_charge": [KEY_SPACE, KEY_ENTER],
	"tw_restart": [KEY_R],
}


func _enter_tree() -> void:
	for action in KEY_BINDS:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		for key in KEY_BINDS[action]:
			var ev := InputEventKey.new()
			ev.physical_keycode = key
			InputMap.action_add_event(action, ev)
