extends Node2D
## Turtle Wars vertical slice (brief §8): one Turf Beach, one rival gang, one
## full tide cycle, hero lens only. The whole level is built in code — the
## .tscn is just this script on a Node2D.
##
## Win:  hold SECURE_SHARE of the dry turf for SECURE_HOLD seconds before
##       high tide ("secure the beach").
## Lose: the rival gang secures first, or high tide arrives — the sea took
##       the turf. The turtle never drowns (§4a).

enum State { RECEDE, BATTLE, WON, LOST }

# --- Feel-tuning knobs (§9 step 2 lives here) -------------------------------
const SECURE_SHARE := 0.6
const SECURE_HOLD := 3.0
const RIVAL_COUNT := 3
const BUZZER_SECONDS := 1.2  # near-miss slow-mo window before high tide
const BUZZER_TIME_SCALE := 0.45

var state := State.RECEDE
var secure_player := 0.0
var secure_rival := 0.0

var tide: TWTide
var turf: TWTurf
var player: TWPlayer
var cam: TWCam
var hud: TWHud
var rivals: Array[TWRival] = []

var _thump_timer := 1.0
var _slowmo_left := 0.0
var _buzzer_used := false


func _ready() -> void:
	randomize()
	Engine.time_scale = 1.0

	turf = TWTurf.new()
	add_child(turf)

	tide = TWTide.new()
	tide.high_tide.connect(_on_high_tide)
	add_child(tide)  # water renders over turf; drowned tiles vanish beneath it

	player = TWPlayer.new()
	player.position = Vector2(640, 260)
	player.turf = turf
	player.tide = tide
	player.add_to_group("player")
	player.landed_hit.connect(_on_ram_hit)
	add_child(player)

	# The rival gang swims in from the sea at the bottom of the screen.
	for i in RIVAL_COUNT:
		var r := TWRival.new()
		r.position = Vector2(340 + i * 300, 660)
		r.turf = turf
		r.tide = tide
		r.landed_hit.connect(_on_ram_hit)
		add_child(r)
		rivals.append(r)

	cam = TWCam.new()
	cam.position = Vector2(640, 360)
	add_child(cam)
	cam.make_current()

	var layer := CanvasLayer.new()
	add_child(layer)
	hud = TWHud.new()
	hud.set_anchors_preset(Control.PRESET_FULL_RECT)
	hud.restart_requested.connect(_restart)
	layer.add_child(hud)
	player.hud = hud

	hud.message = "LOW TIDE"
	hud.submessage = "Claim %d%% of the beach before the sea takes it back" % int(SECURE_SHARE * 100)


func _process(delta: float) -> void:
	if Input.is_action_just_pressed("tw_restart"):
		_restart()
		return

	if _slowmo_left > 0.0:
		_slowmo_left -= delta / maxf(Engine.time_scale, 0.05)
		if _slowmo_left <= 0.0:
			Engine.time_scale = 1.0

	var flooded := turf.update_flooding(tide.waterline_y)
	if flooded > 0 and state == State.BATTLE:
		Sfx.play("flood", randf_range(0.8, 1.0), -10.0)

	match state:
		State.RECEDE:
			if tide.elapsed >= tide.recede_time:
				state = State.BATTLE
				hud.message = ""
				hud.submessage = ""
		State.BATTLE:
			_battle_tick(delta)
		_:
			pass

	_update_hud()


func _battle_tick(delta: float) -> void:
	var c := turf.counts()
	var dry: int = c.dry
	if dry > 0:
		secure_player = _tick_secure(secure_player, float(c.player) / dry >= SECURE_SHARE, delta)
		secure_rival = _tick_secure(secure_rival, float(c.rival) / dry >= SECURE_SHARE, delta)
		if secure_player >= SECURE_HOLD:
			_win()
			return
		if secure_rival >= SECURE_HOLD:
			_lose("THE BREAKERS TOOK THE BEACH")
			return

	# Buzzer-beater: if you're mid-secure as the final flood closes in, dip
	# into slow-mo so the win (or the loss) lands in dramatic near-miss time.
	if not _buzzer_used and secure_player > 0.0 and tide.seconds_left() < BUZZER_SECONDS:
		_buzzer_used = true
		Engine.time_scale = BUZZER_TIME_SCALE
		_slowmo_left = BUZZER_SECONDS / BUZZER_TIME_SCALE + 0.5

	# Rising-tension heartbeat: faster and louder as the tide climbs.
	var p := tide.rise_progress()
	_thump_timer -= delta
	if _thump_timer <= 0.0 and p > 0.0:
		_thump_timer = lerpf(1.15, 0.34, p)
		Sfx.play("thump", lerpf(0.9, 1.25, p), lerpf(-14.0, -4.0, p))


func _tick_secure(value: float, holding: bool, delta: float) -> float:
	if holding:
		return value + delta
	return maxf(0.0, value - delta * 2.5)


func _win() -> void:
	state = State.WON
	Sfx.play("win")
	cam.shake(0.5)
	hud.message_color = TWHud.COL_PLAYER
	var spare := tide.seconds_left()
	_end_round("BEACH SECURED", "%d seconds to spare — tap or press R for the next tide" % int(spare))


func _lose(reason: String) -> void:
	state = State.LOST
	Sfx.play("lose")
	hud.message_color = TWHud.COL_RIVAL
	_end_round(reason, "Tap or press R to run it back")


func _on_high_tide() -> void:
	if state == State.BATTLE or state == State.RECEDE:
		_lose("THE SEA TOOK THE TURF")


func _end_round(msg: String, sub: String) -> void:
	player.frozen = true
	for r in rivals:
		r.frozen = true
	tide.frozen = true
	hud.game_over = true
	hud.message = msg
	hud.submessage = sub


func _restart() -> void:
	Engine.time_scale = 1.0
	get_tree().reload_current_scene()


func _on_ram_hit(_target) -> void:
	cam.shake(0.45)


func _update_hud() -> void:
	var c := turf.counts()
	var dry: int = maxi(1, c.dry)
	hud.share_player = float(c.player) / dry
	hud.share_rival = float(c.rival) / dry
	hud.secure_player = secure_player / SECURE_HOLD
	hud.secure_rival = secure_rival / SECURE_HOLD
	hud.seconds_left = tide.seconds_left()
	hud.rise_progress = tide.rise_progress()
	hud.cooldown_frac = 1.0 - player.charge_cooldown / TWTurtle.CHARGE_COOLDOWN


func _draw() -> void:
	# Static backdrop: synthwave sky, striped sunset sun, dune ridge, palm
	# silhouettes, and warm sand darkening toward the sea.
	draw_rect(Rect2(0, 0, 1280, 140), Color(0.09, 0.04, 0.18))
	var sun := Vector2(640, 118)
	for i in 5:
		draw_circle(sun, 64.0 + i * 10.0, Color(1.0, 0.35, 0.5, 0.05))
	draw_circle(sun, 60.0, Color(1.0, 0.42, 0.45))
	for i in 4:
		draw_rect(Rect2(sun.x - 62, sun.y - 30 + i * 18, 124, 5), Color(0.09, 0.04, 0.18))

	draw_rect(Rect2(0, 140, 1280, 580), Color(0.83, 0.62, 0.42))
	for i in 6:
		draw_rect(Rect2(0, 140 + i * 97, 1280, 97), Color(0.0, 0.0, 0.12, 0.03 + i * 0.012))
	draw_rect(Rect2(0, 134, 1280, 10), Color(0.16, 0.09, 0.22))

	for px: float in [150.0, 1120.0]:
		var top := Vector2(px + 6, 106)
		draw_line(Vector2(px, 140), top, Color(0.05, 0.02, 0.1), 5.0)
		for k in 5:
			var a := -PI * 0.15 - k * 0.32
			draw_line(top, top + Vector2.from_angle(a) * 26.0, Color(0.05, 0.02, 0.1), 3.0)
