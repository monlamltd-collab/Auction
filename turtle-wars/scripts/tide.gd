class_name TWTide
extends Node2D
## The rising water — the level's clock and its arena-shrinker (brief §4).
## On a Turf Beach the water is the enemy: it reclaims the land and is the
## deadline. It is NEVER a threat to a turtle's life (§4a) — it just takes
## the turf back. The waterline must always read instantly (§7), so it gets
## a bright neon foam edge.

signal high_tide

const SCREEN_W := 1280.0
const SCREEN_H := 720.0
const START_Y := 400.0  # waterline before the tide pulls out
const LOW_Y := 700.0  # full low tide: almost the whole beach is dry
const HIGH_Y := 150.0  # high tide: the sea has taken the turf

@export var recede_time := 5.0
@export var slack_time := 3.0
@export var rise_time := 80.0  # whole window sits inside the 60-120 s spec (§8)

var elapsed := 0.0
var waterline_y := START_Y
var reached_high_tide := false
var frozen := false

var _wave_phase := 0.0


func rise_progress() -> float:
	return clampf((elapsed - recede_time - slack_time) / rise_time, 0.0, 1.0)


func seconds_left() -> float:
	return maxf(0.0, recede_time + slack_time + rise_time - elapsed)


func _process(delta: float) -> void:
	_wave_phase += delta * 2.4
	if not frozen:
		elapsed += delta
		_update_waterline()
	queue_redraw()


func _update_waterline() -> void:
	if elapsed < recede_time:
		waterline_y = lerpf(START_Y, LOW_Y, ease(elapsed / recede_time, 0.6))
	elif elapsed < recede_time + slack_time:
		waterline_y = LOW_Y
	else:
		var p := rise_progress()
		# Ease-in: the rise accelerates late, squeezing the endgame.
		waterline_y = lerpf(LOW_Y, HIGH_Y, ease(p, 1.4))
		if p >= 1.0 and not reached_high_tide:
			reached_high_tide = true
			high_tide.emit()


func _draw() -> void:
	var edge := PackedVector2Array()
	var step := 16
	var x := -step
	while x <= int(SCREEN_W) + step:
		var fx := float(x)
		var y := waterline_y \
			+ sin(_wave_phase + fx * 0.018) * 6.0 \
			+ sin(_wave_phase * 1.7 + fx * 0.043) * 3.0
		edge.append(Vector2(fx, y))
		x += step

	# Water body: deep synthwave blue-purple.
	var body := edge.duplicate()
	body.append(Vector2(SCREEN_W + step, SCREEN_H + 80.0))
	body.append(Vector2(-step, SCREEN_H + 80.0))
	draw_colored_polygon(body, Color(0.075, 0.06, 0.28, 0.92))

	# Depth glow lines fading down from the edge.
	for i in range(1, 5):
		var glow := PackedVector2Array()
		for p in edge:
			glow.append(p + Vector2(0, i * 22.0))
		draw_polyline(glow, Color(0.55, 0.2, 0.9, 0.16 - i * 0.03), 2.0)

	# Neon foam line — the deadline itself.
	draw_polyline(edge, Color(0.45, 1.0, 1.0, 0.95), 3.0)
	var foam := PackedVector2Array()
	for p in edge:
		foam.append(p + Vector2(0, 7.0))
	draw_polyline(foam, Color(1, 1, 1, 0.28), 1.5)
