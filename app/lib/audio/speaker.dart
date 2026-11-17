import 'dart:collection';

import 'package:flutter_tts/flutter_tts.dart';

/// Splits streamed text into sentences as soon as each one is complete.
class SentenceBuffer {
  static final _boundary = RegExp(r'''[.!?]+["')\]]*\s''');
  String _pending = '';

  List<String> add(String delta) {
    _pending += delta;
    final sentences = <String>[];
    while (true) {
      final match = _boundary.firstMatch(_pending);
      if (match == null) break;
      sentences.add(_pending.substring(0, match.end).trim());
      _pending = _pending.substring(match.end);
    }
    return sentences;
  }

  /// Whatever is left when the reply ends.
  String? flush() {
    final rest = _pending.trim();
    _pending = '';
    return rest.isEmpty ? null : rest;
  }
}

/// Speaks a streamed reply sentence by sentence and can be cut off mid-reply.
class Speaker {
  final FlutterTts _tts = FlutterTts();
  final Queue<String> _queue = Queue<String>();
  final StringBuffer _spoken = StringBuffer();
  SentenceBuffer _sentences = SentenceBuffer();
  bool _replyDone = false;
  int _generation = 0;
  int _pumping = -1;

  /// Called when a whole reply has been spoken to the end.
  void Function()? onIdle;

  Future<void> init() async {
    await _tts.setLanguage('en-US');
    await _tts.setSpeechRate(0.5);
    await _tts.awaitSpeakCompletion(true);
  }

  void startReply() {
    _spoken.clear();
    _sentences = SentenceBuffer();
    _replyDone = false;
  }

  void addText(String delta) {
    _queue.addAll(_sentences.add(delta));
    _pump();
  }

  void finishReply() {
    final rest = _sentences.flush();
    if (rest != null) _queue.add(rest);
    _replyDone = true;
    _pump();
  }

  /// Stops talking now and returns only what was fully spoken aloud.
  Future<String> interrupt() async {
    _generation++;
    _queue.clear();
    _sentences = SentenceBuffer();
    final spoken = _spoken.toString().trim();
    _spoken.clear();
    await _tts.stop();
    return spoken;
  }

  Future<void> dispose() => _tts.stop();

  Future<void> _pump() async {
    final generation = _generation;
    if (_pumping == generation) return;
    _pumping = generation;
    while (_queue.isNotEmpty && generation == _generation) {
      final sentence = _queue.removeFirst();
      await _tts.speak(sentence);
      if (generation == _generation) _spoken.write('$sentence ');
    }
    if (_pumping == generation) _pumping = -1;
    if (generation == _generation && _replyDone && _queue.isEmpty) {
      _replyDone = false;
      onIdle?.call();
    }
  }
}
