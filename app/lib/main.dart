import 'package:flutter/material.dart';

import 'ui/conversation_screen.dart';

void main() => runApp(const TalkBuddyApp());

class TalkBuddyApp extends StatelessWidget {
  const TalkBuddyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'TalkBuddy',
      theme: ThemeData(colorSchemeSeed: Colors.teal, brightness: Brightness.light),
      darkTheme: ThemeData(colorSchemeSeed: Colors.teal, brightness: Brightness.dark),
      home: const ConversationScreen(),
    );
  }
}
