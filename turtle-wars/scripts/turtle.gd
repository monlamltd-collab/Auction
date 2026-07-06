class_name TWTurtle
extends CharacterBody2D
## Shared turtle body: top-down movement, the shell-charge, stuns, claiming,
## and fully procedural drawing (shell = armour + weapon + identity, §2).
## The water never threatens a turtle (§4a) — swimming is actually FASTER.

signal landed_hit(target)

const RADIUS := 20.0
const CHARGE_TIME := 0.28
const CHARGE_COOLDOWN := 1.1
const CHARGE_SPEED := 720.0
const CHARGE_CLAIM_RADIUS := 56.0  # a charge carves a wider stripe of turf
const KNOCKBACK := 420.0
const STUN_TIME := 1.4
const SWIM_BOOST := 1.35
const BOUNDS := Rect2(28, 140, 1224, 552)

var gang := 0  # 1 player (cyan), 2 rival (magenta)
var shell_color := Color.WHITE
var move_speed := 220.0
var claim_radius := 34.0

var turf: TWTurf
var tide: TWTide

var charge_left := 0.0
var charge_cooldown := 0.0
var stun_left := 0.0
var knock := Vector2.ZERO
var facing := Vector2.RIGHT
var frozen := false

var _swim_phase := 0.0
var _hit_flash := 0.0


func _ready() -> void:
	motion_mode = CharacterBody2D.MOTION_MODE_FLOATING
	var shape := CollisionShape2D.new()
	var circle := CircleShape2D.new()
	circle.radius = RADIUS * 0.9
	shape.shape = circle
	add_child(shape)
	add_to_group("turtles")


func _physics_process(delta: float) -> void:
	if frozen:
		return
	charge_cooldown = maxf(0.0, charge_cooldown - delta)
	stun_left = maxf(0.0, stun_left - delta)
	_hit_flash = maxf(0.0, _hit_flash - delta)

	var wish := Vector2.ZERO
	if stun_left <= 0.0:
		wish = _decide_move(delta)

	if charge_left > 0.0:
		charge_left -= delta
		velocity = facing * CHARGE_SPEED
		_ram_check()
	else:
		var speed := move_speed
		if is_in_water():
			speed *= SWIM_BOOST
		velocity = wish * speed
		if wish.length() > 0.1:
			facing = facing.slerp(wish.normalized(), clampf(delta * 10.0, 0.0, 1.0))

	velocity += knock
	knock = knock.move_toward(Vector2.ZERO, delta * 1400.0)

	move_and_slide()
	position = position.clamp(BOUNDS.position, BOUNDS.end)
	rotation = facing.angle()
	_swim_phase += delta * (3.0 + velocity.length() * 0.02)

	if stun_left <= 0.0 and turf != null:
		var radius := claim_radius
		if charge_left > 0.0:
			radius = CHARGE_CLAIM_RADIUS
		var got := turf.claim_around(global_position, gang, radius)
		if got > 0:
			_on_claimed(got)
	queue_redraw()


func try_charge() -> void:
	if charge_cooldown > 0.0 or stun_left > 0.0 or charge_left > 0.0 or frozen:
		return
	charge_left = CHARGE_TIME
	charge_cooldown = CHARGE_COOLDOWN
	Sfx.play("charge", randf_range(0.9, 1.1), -4.0)


func receive_hit(dir: Vector2) -> void:
	stun_left = STUN_TIME
	knock = dir.normalized() * KNOCKBACK
	charge_left = 0.0
	_hit_flash = 0.25
	Sfx.play("hit", randf_range(0.9, 1.1))


func is_in_water() -> bool:
	return tide != null and global_position.y > tide.waterline_y


## Overridden by player (input) and rival (AI). Returns a direction, length <= 1.
func _decide_move(_delta: float) -> Vector2:
	return Vector2.ZERO


## Overridden for per-gang claim feedback.
func _on_claimed(_count: int) -> void:
	pass


func _ram_check() -> void:
	for node in get_tree().get_nodes_in_group("turtles"):
		var other := node as TWTurtle
		if other == self or other.gang == gang or other.stun_left > 0.0:
			continue
		if global_position.distance_to(other.global_position) < RADIUS * 2.0:
			other.receive_hit(facing)
			charge_left = 0.0
			landed_hit.emit(other)
			return


func _draw() -> void:
	var body := shell_color.darkened(0.65)
	var rim := shell_color
	if stun_left > 0.0:
		rim = rim.darkened(0.5)
	if _hit_flash > 0.0:
		rim = Color.WHITE

	# Flippers paddle with movement (drawn in local space; node faces +X).
	var wag := sin(_swim_phase) * 0.5
	for side: float in [-1.0, 1.0]:
		_draw_flipper(Vector2(10, side * 16), (0.5 + wag * 0.4) * side)
		_draw_flipper(Vector2(-12, side * 15), (0.8 - wag * 0.4) * side)

	# Head.
	draw_circle(Vector2(RADIUS + 5, 0), 7.0, body.lightened(0.15))
	draw_circle(Vector2(RADIUS + 8, 3), 1.6, Color.BLACK)
	draw_circle(Vector2(RADIUS + 8, -3), 1.6, Color.BLACK)

	# Shell: dark dome, neon rim, inner ring, petroglyph-ish scute lines.
	draw_circle(Vector2.ZERO, RADIUS, body)
	draw_arc(Vector2.ZERO, RADIUS, 0.0, TAU, 32, rim, 3.0)
	draw_arc(Vector2.ZERO, RADIUS * 0.62, 0.0, TAU, 24, Color(rim, 0.55), 2.0)
	for k in 6:
		var a := TAU * k / 6.0
		var spoke := Vector2.from_angle(a)
		draw_line(spoke * RADIUS * 0.62, spoke * (RADIUS - 2.0), Color(rim, 0.4), 1.5)

	# Charge afterimage trail.
	if charge_left > 0.0:
		for j in range(1, 4):
			draw_circle(Vector2(-j * 14.0, 0), RADIUS * (1.0 - j * 0.18), Color(rim, 0.16))

	# Dizzy stars while stunned.
	if stun_left > 0.0:
		for s in 3:
			var ang := _swim_phase * 2.0 + TAU * s / 3.0
			var at := Vector2.from_angle(ang) * 10.0 + Vector2(0, -RADIUS - 8)
			draw_circle(at, 2.5, Color(1, 1, 0.4))


func _draw_flipper(at: Vector2, tilt: float) -> void:
	var tip := at + Vector2.from_angle(tilt) * 14.0
	draw_line(at, tip, shell_color.darkened(0.55), 7.0)
