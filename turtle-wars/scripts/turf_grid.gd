class_name TWTurf
extends Node2D
## The claimable beach: a grid of turf tiles (§4d turf-claim variant).
## Owner ids: 0 unclaimed, 1 player gang, 2 rival gang.
## Tiles under the waterline are "wet" — out of play. They re-emerge unowned
## as the tide pulls out at level start, and drown for good as it rises.

const COLS := 18
const ROWS := 8
const TILE := 64.0
const ORIGIN := Vector2(64, 152)

const COL_SAND_LINE := Color(1.0, 0.75, 0.5, 0.10)
const COL_PLAYER := Color(0.1, 0.95, 1.0)
const COL_RIVAL := Color(1.0, 0.18, 0.65)
const POP_TIME := 0.22

var owner_of := PackedInt32Array()
var wet := PackedByteArray()
var pop := PackedFloat32Array()  # per-tile claim-pop animation clock


func _ready() -> void:
	owner_of.resize(COLS * ROWS)
	wet.resize(COLS * ROWS)
	pop.resize(COLS * ROWS)


func tile_center(i: int) -> Vector2:
	@warning_ignore("integer_division")
	var cy := i / COLS
	var cx := i % COLS
	return ORIGIN + Vector2((cx + 0.5) * TILE, (cy + 0.5) * TILE)


func claim_around(world_pos: Vector2, who: int, radius: float) -> int:
	var claimed := 0
	for i in owner_of.size():
		if wet[i] == 1 or owner_of[i] == who:
			continue
		if tile_center(i).distance_to(world_pos) <= radius:
			owner_of[i] = who
			pop[i] = POP_TIME
			claimed += 1
	return claimed


func update_flooding(waterline_y: float) -> int:
	var newly_flooded := 0
	for i in owner_of.size():
		var under := tile_center(i).y > waterline_y - 6.0
		if under and wet[i] == 0:
			wet[i] = 1
			newly_flooded += 1
		elif not under and wet[i] == 1:
			wet[i] = 0
			owner_of[i] = 0
	return newly_flooded


func counts() -> Dictionary:
	var player := 0
	var rival := 0
	var dry := 0
	for i in owner_of.size():
		if wet[i] == 1:
			continue
		dry += 1
		if owner_of[i] == 1:
			player += 1
		elif owner_of[i] == 2:
			rival += 1
	return {"player": player, "rival": rival, "dry": dry}


func nearest_claimable(from: Vector2, who: int) -> Vector2:
	# AI helper: roughly the nearest dry tile this gang doesn't own. Distance
	# is jittered so rival turtles fan out instead of stacking on one tile.
	var best := -1
	var best_d := INF
	for i in owner_of.size():
		if wet[i] == 1 or owner_of[i] == who:
			continue
		var d := tile_center(i).distance_squared_to(from) * randf_range(0.75, 1.25)
		if d < best_d:
			best_d = d
			best = i
	if best < 0:
		return from
	return tile_center(best)


func _process(delta: float) -> void:
	for i in pop.size():
		if pop[i] > 0.0:
			pop[i] = maxf(0.0, pop[i] - delta)
	queue_redraw()


func _draw() -> void:
	for i in owner_of.size():
		if wet[i] == 1:
			continue
		var c := tile_center(i)
		var half := TILE * 0.5 - 3.0
		var rect := Rect2(c - Vector2(half, half), Vector2(half, half) * 2.0)
		match owner_of[i]:
			1:
				_draw_claimed(rect, c, COL_PLAYER, pop[i])
			2:
				_draw_claimed(rect, c, COL_RIVAL, pop[i])
			_:
				draw_rect(rect, COL_SAND_LINE, false, 1.0)


func _draw_claimed(rect: Rect2, center: Vector2, col: Color, pop_t: float) -> void:
	# Claim pop: the tile flashes bright and overshoots its size, then settles.
	var grow := 1.0 + pop_t * 1.6
	var r := Rect2(center - rect.size * 0.5 * grow, rect.size * grow)
	draw_rect(r, Color(col.r, col.g, col.b, 0.22 + pop_t * 2.0), true)
	draw_rect(r, Color(col.r, col.g, col.b, 0.85), false, 2.0)
