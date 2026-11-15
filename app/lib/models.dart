class StructureNote {
  const StructureNote({required this.issue, required this.fix, required this.why});

  final String issue;
  final String fix;
  final String why;
}

/// Silent correction shown under a learner turn.
class CorrectionCard {
  const CorrectionCard({
    required this.wasFine,
    required this.naturalVersion,
    required this.notes,
    this.pronunciationWord,
    this.pronunciationTip,
  });

  factory CorrectionCard.fromJson(Map<String, dynamic> json) {
    final pronunciation = json['pronunciation'] as Map<String, dynamic>?;
    return CorrectionCard(
      wasFine: json['was_fine'] as bool,
      naturalVersion: json['natural_version'] as String,
      notes: [
        for (final note in json['structure_notes'] as List<dynamic>)
          StructureNote(
            issue: note['issue'] as String,
            fix: note['fix'] as String,
            why: note['why'] as String,
          ),
      ],
      pronunciationWord: pronunciation?['word'] as String?,
      pronunciationTip: pronunciation?['tip'] as String?,
    );
  }

  final bool wasFine;
  final String naturalVersion;
  final List<StructureNote> notes;
  final String? pronunciationWord;
  final String? pronunciationTip;
}

class Turn {
  Turn({required this.turnId, required this.isUser, this.text = ''});

  final int turnId;
  final bool isUser;
  String text;
  CorrectionCard? card;
  bool interrupted = false;
}

enum SessionState { connecting, listening, thinking, speaking, offline }
