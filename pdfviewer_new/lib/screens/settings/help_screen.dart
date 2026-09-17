import 'package:flutter/material.dart';

import '../../core/constants/app_colors.dart';

class HelpScreen extends StatelessWidget {
  const HelpScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Help & FAQ'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: const [
          _FaqItem(
            question: 'How do I open a PDF from my phone storage?',
            answer:
                'Tap the "Open PDF" button on the home screen or the "+" Floating Action Button. Choose any PDF file from your Android storage picker.',
          ),
          _FaqItem(
            question: 'How do I search for text inside a PDF?',
            answer:
                'Open the document in the reader, tap the Search icon in the top app bar, enter your search query, and use the arrow buttons to jump between matches.',
          ),
          _FaqItem(
            question: 'Does the reader save my reading progress?',
            answer:
                'Yes! Whenever you read a document, the app automatically saves your current page and scroll position so you can pick up right where you left off.',
          ),
          _FaqItem(
            question: 'How do I add a bookmark?',
            answer:
                'Inside the PDF reader, tap the Bookmark icon in the top app bar to view and add bookmarks for your current page.',
          ),
          _FaqItem(
            question: 'Where are my files stored?',
            answer:
                'PDF Viewer works directly with files on your device storage without duplicating them, preserving storage space.',
          ),
        ],
      ),
    );
  }
}

class _FaqItem extends StatelessWidget {
  const _FaqItem({required this.question, required this.answer});

  final String question;
  final String answer;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: isDark ? AppColors.cardDark : AppColors.cardLight,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isDark ? AppColors.borderDark : AppColors.borderLight,
        ),
      ),
      child: ExpansionTile(
        title: Text(
          question,
          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
        ),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        children: [
          Text(
            answer,
            style: TextStyle(
              fontSize: 13,
              height: 1.4,
              color: isDark ? AppColors.textSecondaryDark : AppColors.textSecondaryLight,
            ),
          ),
        ],
      ),
    );
  }
}
