class_name TWHud
extends Control
## All UI in one Control on a CanvasLayer: turf-share bar, tide countdown,
## securing meter, win/lose overlay, and the touch controls (virtual stick on
## the left half of the screen, charge button bottom-right).

signal restart_requested

const COL_PLAYER := Color(0.1, 0.95, 1.0)
const COL_RIVAL := Color(1.0, 0.18, 0.65)
const STICK_RADIUS := 70.0
const BUTTON_POS := Vector2(1160, 600)
const BUTTON_RADIUS := 56.0

# Written by main.gd every frame.
var share_player := 0.0
var share_rival := 0.0
var secure_player := 0.0  # 0..1 fraction of the secure hold
var secure_rival := 0.0
var seconds_left := 0.0
var rise_progress := 0.0
var cooldown_frac := 1.0  # 1 = charge ready
var game_over := false
var message := ""
var submessage := ""
var message_color := Color.WHITE

var stick_vector := Vector2.ZERO

var _stick_finger := -1
var _stick_origin := Vector2.ZERO
var _charge_tap := false
var _flash := 0.0


func consume_charge_tap() -> bool:
	var t := _charge_tap
	_charge_tap = false
	return t


func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed:
			_touch_began(event.index, event.position)
		else:
			_touch_ended(event.index)
	elif event is InputEventScreenDrag:
		if event.index == _stick_finger:
			var pull: Vector2 = event.position - _stick_origin
			stick_vector = pull.limit_length(STICK_RADIUS) / STICK_RADIUS


func _touch_began(index: int, pos: Vector2) -> void:
	if game_over:
		restart_requested.emit()
		return
	if pos.distance_to(BUTTON_POS) <= BUTTON_RADIUS * 1.3:
		_charge_tap = true
	elif pos.x < size.x * 0.5 and _stick_finger < 0:
		_stick_finger = index
		_stick_origin = pos
		stick_vector = Vector2.ZERO


func _touch_ended(index: int) -> void:
	if index == _stick_finger:
		_stick_finger = -1
		stick_vector = Vector2.ZERO


func _process(delta: float) -> void:
	_flash += delta
	queue_redraw()


func _draw() -> void:
	var font := ThemeDB.fallback_font
	_draw_share_bar(font)
	_draw_timer(font)
	if not game_over:
		if secure_player > 0.0:
			_draw_secure_bar("SECURING THE BEACH", secure_player, COL_PLAYER, font)
		elif secure_rival > 0.0:
			_draw_secure_bar("THE BREAKERS ARE SECURING!", secure_rival, COL_RIVAL, font)
	if game_over:
		draw_rect(Rect2(Vector2.ZERO, size), Color(0, 0, 0, 0.55))
	if message != "":
		draw_string(font, Vector2(0, size.y * 0.42), message,
				HORIZONTAL_ALIGNMENT_CENTER, size.x, 52, message_color)
	if submessage != "":
		draw_string(font, Vector2(0, size.y * 0.42 + 44), submessage,
				HORIZONTAL_ALIGNMENT_CENTER, size.x, 20, Color(1, 1, 1, 0.8))
	_draw_touch_controls(font)


func _draw_share_bar(font: Font) -> void:
	var bar := Rect2(340, 20, 600, 22)
	draw_rect(bar, Color(0, 0, 0, 0.45))
	if share_player > 0.0:
		draw_rect(Rect2(bar.position, Vector2(bar.size.x * share_player, bar.size.y)),
				Color(COL_PLAYER, 0.85))
	if share_rival > 0.0:
		var w := bar.size.x * share_rival
		draw_rect(Rect2(Vector2(bar.end.x - w, bar.position.y), Vector2(w, bar.size.y)),
				Color(COL_RIVAL, 0.85))
	# Goal ticks: player needs 60% from the left, rival 60% from the right.
	for frac: float in [0.6, 0.4]:
		var x := bar.position.x + bar.size.x * frac
		draw_line(Vector2(x, bar.position.y - 3), Vector2(x, bar.end.y + 3), Color(1, 1, 1, 0.7), 2.0)
	draw_rect(bar, Color(1, 1, 1, 0.35), false, 1.0)
	draw_string(font, Vector2(bar.position.x - 60, bar.position.y + 17),
			"%d%%" % roundi(share_player * 100), HORIZONTAL_ALIGNMENT_LEFT, -1, 16, COL_PLAYER)
	draw_string(font, Vector2(bar.end.x + 12, bar.position.y + 17),
			"%d%%" % roundi(share_rival * 100), HORIZONTAL_ALIGNMENT_LEFT, -1, 16, COL_RIVAL)


func _draw_timer(font: Font) -> void:
	@warning_ignore("integer_division")
	var mins := int(seconds_left) / 60
	var secs := int(seconds_left) % 60
	var urgent := rise_progress > 0.0 and seconds_left <= 10.0
	var col := Color(1, 1, 1, 0.9)
	if urgent:
		col = Color(1, 0.25, 0.3) if fmod(_flash, 0.5) < 0.25 else Color(1, 0.6, 0.6)
	draw_string(font, Vector2(size.x - 130, 44), "%d:%02d" % [mins, secs],
			HORIZONTAL_ALIGNMENT_LEFT, -1, 30 if urgent else 26, col)
	if rise_progress > 0.0:
		draw_string(font, Vector2(size.x - 130, 64), "TIDE RISING",
				HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(0.45, 1, 1, 0.8))


func _draw_secure_bar(label: String, frac: float, col: Color, font: Font) -> void:
	var r := Rect2(size.x * 0.5 - 180, 92, 360, 14)
	draw_string(font, Vector2(r.position.x, r.position.y - 8), label,
			HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 18, col)
	draw_rect(r, Color(0, 0, 0, 0.5))
	draw_rect(Rect2(r.position, Vector2(r.size.x * clampf(frac, 0.0, 1.0), r.size.y)), Color(col, 0.9))
	draw_rect(r, Color(1, 1, 1, 0.4), false, 1.0)


func _draw_touch_controls(font: Font) -> void:
	if _stick_finger >= 0:
		draw_circle(_stick_origin, STICK_RADIUS, Color(1, 1, 1, 0.06))
		draw_arc(_stick_origin, STICK_RADIUS, 0, TAU, 32, Color(1, 1, 1, 0.25), 2.0)
		draw_circle(_stick_origin + stick_vector * STICK_RADIUS, 26, Color(1, 1, 1, 0.25))
	var ready := cooldown_frac >= 1.0
	var bcol := COL_PLAYER if ready else Color(1, 1, 1, 0.3)
	draw_circle(BUTTON_POS, BUTTON_RADIUS, Color(bcol, 0.15))
	if cooldown_frac > 0.02:
		draw_arc(BUTTON_POS, BUTTON_RADIUS, -PI / 2,
				-PI / 2 + TAU * clampf(cooldown_frac, 0.0, 1.0), 32, bcol, 3.0)
	draw_string(font, Vector2(BUTTON_POS.x - BUTTON_RADIUS, BUTTON_POS.y + 6), "CHARGE",
			HORIZONTAL_ALIGNMENT_CENTER, BUTTON_RADIUS * 2, 16, Color(bcol, 0.9))
