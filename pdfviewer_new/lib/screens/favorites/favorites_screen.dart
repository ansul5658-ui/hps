import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/constants/app_colors.dart';
import '../../models/pdf_document_meta.dart';
import '../../models/view_mode.dart';
import '../../repositories/library_repository.dart';
import '../details/file_details_sheet.dart';
import '../home/widgets/document_grid_tile.dart';
import '../home/widgets/document_list_tile.dart';
import '../viewer/pdf_viewer_screen.dart';

class FavoritesScreen extends StatelessWidget {
  const FavoritesScreen({super.key});

  void _openDocument(BuildContext context, PdfDocumentMeta document) {
    if (!document.existsOnDisk) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('This file could no longer be found.')),
      );
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => PdfViewerScreen(document: document)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<LibraryRepository>();
    final favorites = repo.favoriteDocuments;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Favorite PDFs'),
      ),
      body: favorites.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: Colors.amber.withOpacity(0.12),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.star_outline_rounded,
                        size: 56,
                        color: Colors.amber,
                      ),
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'No Favorites Yet',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Tap the star icon on any document to add it to your favorites for quick access.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 13,
                        color: isDark
                            ? AppColors.textSecondaryDark
                            : AppColors.textSecondaryLight,
                      ),
                    ),
                  ],
                ),
              ),
            )
          : repo.viewMode == LibraryViewMode.grid
              ? GridView.builder(
                  padding: const EdgeInsets.all(16),
                  gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                    maxCrossAxisExtent: 180,
                    mainAxisSpacing: 12,
                    crossAxisSpacing: 12,
                    childAspectRatio: 0.72,
                  ),
                  itemCount: favorites.length,
                  itemBuilder: (context, index) {
                    final doc = favorites[index];
                    return DocumentGridTile(
                      document: doc,
                      onTap: () => _openDocument(context, doc),
                      onLongPress: () => FileDetailsSheet.show(context, doc),
                      onToggleFavorite: () => repo.toggleFavorite(doc.id),
                    );
                  },
                )
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: favorites.length,
                  itemBuilder: (context, index) {
                    final doc = favorites[index];
                    return DocumentListTile(
                      document: doc,
                      onTap: () => _openDocument(context, doc),
                      onLongPress: () => FileDetailsSheet.show(context, doc),
                      onToggleFavorite: () => repo.toggleFavorite(doc.id),
                    );
                  },
                ),
    );
  }
}
