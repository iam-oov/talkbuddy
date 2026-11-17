import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../audio/mic_stream.dart';
import '../audio/speaker.dart';
import '../models.dart';

const backendUrl = String.fromEnvironment(
  'BACKEND_WS',
  defaultValue: 'ws://127.0.0.1:8787/session',
);
const backendToken = String.fromEnvironment('BACKEND_TOKEN');

Map<String, String> get _authHeaders => backendToken.isEmpty ? {} : {'Authorization': 'Bearer $backendToken'};

/// Owns the live conversation: microphone up, replies down, barge-in.
class SessionController extends ChangeNotifier {
  final MicStream _mic = MicStream();
  final Speaker _speaker = Speaker();
  WebSocketChannel? _channel;
  StreamSubscription<Uint8List>? _micSubscription;
  final Set<int> _cutTurns = {};
  int? _speakingTurnId;

  final List<Turn> turns = [];
  SessionState state = SessionState.offline;
  String partial = '';
  String? error;
  int silenceMs = 2000;
  int? lastLatencyMs;
  List<ModelOption> models = [];
  String modelId = 'claude-sonnet-5-5';

  bool get inCall => state != SessionState.offline;

  ModelOption? get selectedModel => models.where((model) => model.id == modelId).firstOrNull;

  Future<void> loadModels() async {
    final client = HttpClient();
    try {
      final modelsUrl = Uri.parse(backendUrl.replaceFirst('ws', 'http')).replace(path: '/models');
      final request = await client.getUrl(modelsUrl);
      _authHeaders.forEach(request.headers.set);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      _applyModels((jsonDecode(body) as Map<String, dynamic>)['models'] as List<dynamic>);
    } catch (_) {
    } finally {
      client.close();
    }
  }

  void selectModel(String id) {
    modelId = id;
    _send({'type': 'set_model', 'model': id});
    notifyListeners();
  }

  void _applyModels(List<dynamic> raw) {
    models = [for (final entry in raw) ModelOption.fromJson(entry as Map<String, dynamic>)];
    notifyListeners();
  }

  Future<void> start() async {
    error = null;
    turns.clear();
    partial = '';
    lastLatencyMs = null;
    _setState(SessionState.connecting);
    if (!await _mic.hasPermission()) {
      _fail('Microphone permission is needed to talk.');
      return;
    }
    await _speaker.init();
    _speaker.onIdle = _onSpeechFinished;
    try {
      final WebSocketChannel channel = IOWebSocketChannel.connect(Uri.parse(backendUrl), headers: _authHeaders);
      await channel.ready;
      _channel = channel;
      channel.stream.listen(
        _onMessage,
        onDone: () {
          if (_channel == channel) _fail(error ?? 'Connection to the backend closed.');
        },
        onError: (Object e) {
          if (_channel == channel) _fail('Connection error: $e');
        },
      );
    } catch (e) {
      _fail('Cannot reach the backend at $backendUrl. Is it running, and did you run adb reverse?');
    }
  }

  Future<void> hangUp() async {
    error = null;
    partial = '';
    await _teardown();
    _setState(SessionState.offline);
  }

  void sendNow() => _send({'type': 'send_now'});

  void setSilence(int ms) {
    silenceMs = ms;
    _send({'type': 'config', 'silenceMs': ms});
    notifyListeners();
  }

  Future<void> _onMessage(dynamic raw) async {
    if (raw is! String || _channel == null) return;
    final msg = jsonDecode(raw) as Map<String, dynamic>;
    switch (msg['type']) {
      case 'ready':
        _applyModels(msg['models'] as List<dynamic>);
        _send({'type': 'config', 'silenceMs': silenceMs});
        if (msg['model'] != modelId) _send({'type': 'set_model', 'model': modelId});
        final audio = await _mic.start();
        _micSubscription = audio.listen((chunk) => _channel?.sink.add(chunk));
        _setState(SessionState.listening);
      case 'partial':
        partial = msg['text'] as String;
        _setState(_speakingTurnId == null ? SessionState.listening : state);
      case 'user_turn':
        partial = '';
        turns.add(Turn(turnId: msg['turnId'] as int, isUser: true, text: msg['text'] as String));
        _setState(SessionState.thinking);
      case 'reply_delta':
        final turnId = msg['turnId'] as int;
        if (_cutTurns.contains(turnId)) return;
        if (_speakingTurnId != turnId) {
          _speakingTurnId = turnId;
          _speaker.startReply();
          turns.add(Turn(turnId: turnId, isUser: false));
        }
        final delta = msg['text'] as String;
        turns.last.text += delta;
        _speaker.addText(delta);
        _setState(SessionState.speaking);
      case 'reply_done':
        if (_speakingTurnId == msg['turnId']) _speaker.finishReply();
      case 'interrupt':
        await _onInterrupt(msg['turnId'] as int);
      case 'card':
        final turnId = msg['turnId'] as int;
        for (final turn in turns.where((t) => t.isUser && t.turnId == turnId)) {
          turn.card = CorrectionCard.fromJson(msg['card'] as Map<String, dynamic>);
        }
        notifyListeners();
      case 'model':
        modelId = msg['model'] as String;
        notifyListeners();
      case 'latency':
        lastLatencyMs = msg['firstTextMs'] as int;
      case 'error':
        error = msg['message'] as String;
        notifyListeners();
    }
  }

  /// The learner talked over the bot: go quiet at once and keep only what was heard.
  Future<void> _onInterrupt(int turnId) async {
    _cutTurns.add(turnId);
    final wasSpeaking = _speakingTurnId == turnId;
    _speakingTurnId = null;
    final spoken = wasSpeaking ? await _speaker.interrupt() : '';
    final index = turns.indexWhere((t) => !t.isUser && t.turnId == turnId);
    if (index >= 0) {
      if (spoken.isEmpty) {
        turns.removeAt(index);
      } else {
        turns[index]
          ..text = spoken
          ..interrupted = true;
      }
    }
    _send({'type': 'interrupted', 'turnId': turnId, 'spokenText': spoken});
    _setState(SessionState.listening);
  }

  void _onSpeechFinished() {
    final turnId = _speakingTurnId;
    if (turnId == null) return;
    _speakingTurnId = null;
    _send({'type': 'tts_done', 'turnId': turnId});
    _setState(SessionState.listening);
  }

  void _send(Map<String, Object> msg) => _channel?.sink.add(jsonEncode(msg));

  void _setState(SessionState next) {
    state = next;
    notifyListeners();
  }

  Future<void> _fail(String message) async {
    error = message;
    await _teardown();
    _setState(SessionState.offline);
  }

  Future<void> _teardown() async {
    await _micSubscription?.cancel();
    _micSubscription = null;
    await _mic.stop();
    await _speaker.interrupt();
    _speakingTurnId = null;
    final channel = _channel;
    _channel = null;
    await channel?.sink.close();
  }

  @override
  void dispose() {
    _teardown();
    _mic.dispose();
    super.dispose();
  }
}
