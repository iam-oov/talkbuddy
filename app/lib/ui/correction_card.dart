import 'package:flutter/material.dart';

import '../models.dart';

/// Small, glanceable correction under a learner turn. Structure first, one pronunciation tip at most.
class CorrectionCardView extends StatelessWidget {
  const CorrectionCardView({super.key, required this.card});

  final CorrectionCard card;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final hasTip = card.pronunciationWord != null && card.pronunciationTip != null;

    if (card.wasFine && !hasTip) {
      return Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.check_circle, size: 14, color: scheme.primary),
            const SizedBox(width: 4),
            Text('Sounded natural', style: theme.textTheme.labelSmall?.copyWith(color: scheme.primary)),
          ],
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!card.wasFine) ...[
            Text('More natural', style: theme.textTheme.labelSmall?.copyWith(color: scheme.primary)),
            Text(card.naturalVersion, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
            for (final note in card.notes) ...[
              const SizedBox(height: 8),
              Text.rich(
                TextSpan(children: [
                  TextSpan(
                    text: note.issue,
                    style: TextStyle(color: scheme.error, decoration: TextDecoration.lineThrough),
                  ),
                  const TextSpan(text: '  →  '),
                  TextSpan(text: note.fix, style: const TextStyle(fontWeight: FontWeight.w600)),
                ]),
                style: theme.textTheme.bodySmall,
              ),
              Text(note.why, style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
            ],
          ],
          if (hasTip) ...[
            if (!card.wasFine) const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.record_voice_over, size: 14, color: scheme.tertiary),
                const SizedBox(width: 6),
                Expanded(
                  child: Text.rich(
                    TextSpan(children: [
                      TextSpan(
                        text: '${card.pronunciationWord}: ',
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      TextSpan(text: card.pronunciationTip),
                    ]),
                    style: theme.textTheme.bodySmall,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
