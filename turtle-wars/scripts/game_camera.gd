class_name TWCam
extends Camera2D
## Static full-beach camera with trauma-based screen shake (juice, §6).

var _trauma := 0.0


func _ready() -> void:
	ignore_rotation = false  # let the shake's roll component reach the view


func shake(amount: float) -> void:
	_trauma = minf(1.0, _trauma + amount)


func _process(delta: float) -> void:
	_trauma = maxf(0.0, _trauma - delta * 2.4)
	var s := _trauma * _trauma
	offset = Vector2(randf_range(-1, 1), randf_range(-1, 1)) * 16.0 * s
	rotation = randf_range(-1, 1) * 0.012 * s
