class_name TWRival
extends TWTurtle
## The Breakers — the slice's single rival gang (loggerhead bruisers, §6).
## Deliberately simple, readable AI: grab the nearest unowned turf, steal the
## player's turf when it's closer, and charge the player when lined up.

var _target := Vector2.ZERO
var _retarget := 0.0
var _think := 0.0


func _init() -> void:
	gang = 2
	shell_color = Color(1.0, 0.18, 0.65)
	move_speed = 190.0
	claim_radius = 32.0


func _decide_move(delta: float) -> Vector2:
	_retarget -= delta
	_think -= delta

	if _retarget <= 0.0 or global_position.distance_to(_target) < 20.0:
		_retarget = randf_range(0.7, 1.3)
		_target = turf.nearest_claimable(global_position, gang) if turf != null else global_position

	# Occasionally pick a fight: charge the player if close and roughly ahead.
	if _think <= 0.0:
		_think = 0.25
		if charge_cooldown <= 0.0:
			var player := get_tree().get_first_node_in_group("player") as TWTurtle
			if player != null and player.stun_left <= 0.0:
				var to_player := player.global_position - global_position
				if to_player.length() < 150.0 and facing.dot(to_player.normalized()) > 0.7 and randf() < 0.5:
					try_charge()

	var dir := _target - global_position
	if dir.length() < 4.0:
		return Vector2.ZERO
	return dir.normalized()
