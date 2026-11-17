import 'package:flutter/material.dart';

import '../models.dart';
import '../session/session_controller.dart';

/// Compact dropdown to choose which language model drives the tutor and the coach.
class ModelPicker extends StatelessWidget {
  const ModelPicker({super.key, required this.session});

  final SessionController session;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final label = session.selectedModel?.label ?? session.modelId;
    return MenuAnchor(
      alignmentOffset: const Offset(0, 4),
      menuChildren: [
        for (final model in session.models) _ModelItem(model: model, selected: model.id == session.modelId, session: session),
      ],
      builder: (context, controller, _) => TextButton.icon(
        onPressed: session.models.isEmpty
            ? session.loadModels
            : () => controller.isOpen ? controller.close() : controller.open(),
        icon: const Icon(Icons.auto_awesome, size: 16),
        label: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(label, style: theme.textTheme.labelMedium),
            const Icon(Icons.expand_more, size: 16),
          ],
        ),
      ),
    );
  }
}

class _ModelItem extends StatelessWidget {
  const _ModelItem({required this.model, required this.selected, required this.session});

  final ModelOption model;
  final bool selected;
  final SessionController session;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return MenuItemButton(
      onPressed: model.available && !selected ? () => session.selectModel(model.id) : null,
      leadingIcon: Icon(selected ? Icons.check : null, size: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(model.label),
          Text(
            model.available ? model.provider : '${model.provider} · no API key',
            style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}
