import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:talkbuddy/audio/speaker.dart';
import 'package:talkbuddy/models.dart';
import 'package:talkbuddy/ui/correction_card.dart';

void main() {
  test('SentenceBuffer releases each sentence as soon as it is complete', () {
    final buffer = SentenceBuffer();
    expect(buffer.add('That sounds fun! What did'), ['That sounds fun!']);
    expect(buffer.add(' you cook? I love'), ['What did you cook?']);
    expect(buffer.add(' pasta'), isEmpty);
    expect(buffer.flush(), 'I love pasta');
    expect(buffer.flush(), isNull);
  });

  test('CorrectionCard parses the backend JSON', () {
    final card = CorrectionCard.fromJson({
      'was_fine': false,
      'natural_version': "I'm 30 years old.",
      'structure_notes': [
        {'issue': 'I have 30 years', 'fix': "I'm 30 years old", 'why': 'English uses "be" for age.'},
      ],
      'pronunciation': null,
    });
    expect(card.wasFine, isFalse);
    expect(card.notes.single.fix, "I'm 30 years old");
    expect(card.pronunciationWord, isNull);
  });

  testWidgets('a fine turn shows only the small confirmation', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: CorrectionCardView(
          card: CorrectionCard(wasFine: true, naturalVersion: 'ok', notes: []),
        ),
      ),
    ));
    expect(find.text('Sounded natural'), findsOneWidget);
    expect(find.text('More natural'), findsNothing);
  });

  testWidgets('a correction shows the natural version, the fix and the tip', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: CorrectionCardView(
          card: CorrectionCard(
            wasFine: false,
            naturalVersion: 'I went to the store yesterday.',
            notes: [StructureNote(issue: 'I go', fix: 'I went', why: 'Past time needs past tense.')],
            pronunciationWord: 'thought',
            pronunciationTip: 'Say "thawt".',
          ),
        ),
      ),
    ));
    expect(find.text('I went to the store yesterday.'), findsOneWidget);
    expect(find.textContaining('I went', findRichText: true), findsWidgets);
    expect(find.textContaining('thought', findRichText: true), findsOneWidget);
  });
}
