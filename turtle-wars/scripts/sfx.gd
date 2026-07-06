extends Node
## Autoload sound board. The wav files are placeholder synth stings generated
## by tools/generate_sfx.py — replace with real audio in the polish pass.

const NAMES := ["claim", "charge", "hit", "win", "lose", "flood", "thump"]
const VOICES := 12

var _streams := {}
var _players: Array[AudioStreamPlayer] = []


func _ready() -> void:
	for sound_name in NAMES:
		var path := "res://assets/sfx/%s.wav" % sound_name
		if ResourceLoader.exists(path):
			_streams[sound_name] = load(path)
	for _i in VOICES:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_players.append(p)


func play(sound: String, pitch := 1.0, volume_db := 0.0) -> void:
	if not _streams.has(sound):
		return
	for p in _players:
		if not p.playing:
			p.stream = _streams[sound]
			p.pitch_scale = pitch
			p.volume_db = volume_db
			p.play()
			return
