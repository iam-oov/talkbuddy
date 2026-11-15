import 'package:flutter/material.dart';

import '../models.dart';
import '../session/session_controller.dart';
import 'correction_card.dart';

class ConversationScreen extends StatefulWidget {
  const ConversationScreen({super.key});

  @override
  State<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends State<ConversationScreen> {
  final SessionController _session = SessionController();
  final ScrollController _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _session.addListener(_scrollToEnd);
    _session.start();
  }

  @override
  void dispose() {
    _session.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _session,
      builder: (context, _) {
        final scheme = Theme.of(context).colorScheme;
        return Scaffold(
          appBar: AppBar(
            title: const Text('TalkBuddy'),
            actions: [
              if (_session.lastLatencyMs != null)
                Center(
                  child: Padding(
                    padding: const EdgeInsets.only(right: 16),
                    child: Text('${_session.lastLatencyMs} ms', style: Theme.of(context).textTheme.labelSmall),
                  ),
                ),
            ],
          ),
          body: Column(
            children: [
              if (_session.error != null)
                MaterialBanner(
                  backgroundColor: scheme.errorContainer,
                  content: Text(_session.error!),
                  actions: [
                    TextButton(onPressed: _session.start, child: const Text('Retry')),
                  ],
                ),
              Expanded(
                child: ListView(
                  controller: _scroll,
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (_session.turns.isEmpty && _session.partial.isEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 48),
                        child: Text(
                          'Just start talking.\nPause as long as you need. Talk over me whenever you want.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: scheme.onSurfaceVariant),
                        ),
                      ),
                    for (final turn in _session.turns) _TurnBubble(turn: turn),
                    if (_session.partial.isNotEmpty)
                      Align(
                        alignment: Alignment.centerRight,
                        child: Padding(
                          padding: const EdgeInsets.only(top: 8, left: 48),
                          child: Text(
                            _session.partial,
                            textAlign: TextAlign.right,
                            style: TextStyle(color: scheme.onSurfaceVariant, fontStyle: FontStyle.italic),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              _StatusBar(session: _session),
            ],
          ),
        );
      },
    );
  }
}

class _TurnBubble extends StatelessWidget {
  const _TurnBubble({required this.turn});

  final Turn turn;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final card = turn.card;
    return Align(
      alignment: turn.isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Padding(
        padding: EdgeInsets.only(top: 12, left: turn.isUser ? 40 : 0, right: turn.isUser ? 0 : 40),
        child: Column(
          crossAxisAlignment: turn.isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: turn.isUser ? scheme.primaryContainer : scheme.secondaryContainer,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Text(turn.interrupted ? '${turn.text} …' : turn.text),
            ),
            if (card != null) CorrectionCardView(card: card),
          ],
        ),
      ),
    );
  }
}

class _StatusBar extends StatelessWidget {
  const _StatusBar({required this.session});

  final SessionController session;

  static const _labels = {
    SessionState.connecting: 'Connecting…',
    SessionState.listening: 'Listening',
    SessionState.thinking: 'Thinking…',
    SessionState.speaking: 'Speaking — talk to interrupt',
    SessionState.offline: 'Offline',
  };

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final live = session.state != SessionState.offline && session.state != SessionState.connecting;
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
        decoration: BoxDecoration(border: Border(top: BorderSide(color: scheme.outlineVariant))),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Icon(
                  session.state == SessionState.speaking ? Icons.volume_up : Icons.mic,
                  color: live ? scheme.primary : scheme.outline,
                ),
                const SizedBox(width: 8),
                Expanded(child: Text(_labels[session.state]!)),
                FilledButton.tonal(
                  onPressed: live && session.partial.isNotEmpty ? session.sendNow : null,
                  child: const Text('Send now'),
                ),
              ],
            ),
            Row(
              children: [
                Text('Pause before I answer', style: Theme.of(context).textTheme.labelSmall),
                Expanded(
                  child: Slider(
                    min: 1500,
                    max: 4000,
                    divisions: 5,
                    value: session.silenceMs.toDouble(),
                    label: '${(session.silenceMs / 1000).toStringAsFixed(1)} s',
                    onChanged: (value) => session.setSilence(value.round()),
                  ),
                ),
                Text('${(session.silenceMs / 1000).toStringAsFixed(1)} s'),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
