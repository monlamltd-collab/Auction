class_name TWPlayer
extends TWTurtle
## Hero lens (§6a): the one turtle you inhabit on a Turf Beach.
## Keyboard (WASD/arrows + Space) or touch (hud.gd virtual stick + button).

var hud: TWHud


func _init() -> void:
	gang = 1
	shell_color = Color(0.1, 0.95, 1.0)
	move_speed = 235.0


func _physics_process(delta: float) -> void:
	if not frozen:
		var tapped := hud != null and hud.consume_charge_tap()
		if Input.is_action_just_pressed("tw_charge") or tapped:
			try_charge()
	super(delta)


func _decide_move(_delta: float) -> Vector2:
	var dir := Input.get_vector("tw_left", "tw_right", "tw_up", "tw_down")
	if hud != null and hud.stick_vector.length() > 0.15:
		dir = hud.stick_vector
	return dir.limit_length(1.0)


func _on_claimed(_count: int) -> void:
	Sfx.play("claim", randf_range(0.95, 1.35), -6.0)


func _draw() -> void:
	super()
	# Charge-cooldown ring around your own shell.
	if charge_cooldown > 0.0:
		var frac := 1.0 - charge_cooldown / CHARGE_COOLDOWN
		draw_arc(Vector2.ZERO, RADIUS + 6.0, -PI / 2, -PI / 2 + TAU * frac, 24, Color(1, 1, 1, 0.5), 2.0)
