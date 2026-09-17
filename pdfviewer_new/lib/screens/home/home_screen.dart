import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/constants/app_colors.dart';
import '../../models/pdf_document_meta.dart';
import '../../models/view_mode.dart';
import '../../repositories/library_repository.dart';
import '../../services/file_picker_service.dart';
import '../details/file_details_sheet.dart';
import '../viewer/pdf_viewer_screen.dart';
import 'widgets/document_grid_tile.dart';
import 'widgets/document_list_tile.dart';
import 'widgets/empty_states.dart';
import 'widgets/hero_header.dart';
import 'widgets/quick_actions.dart';
import 'widgets/sort_menu.dart';
import '../splash/splash_screen.dart';
class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    this.onNavigateToFavorites,
    this.onNavigateToBookmarks,
    this.onNavigateToSettings,
  });

  final VoidCallback? onNavigateToFavorites;
  final VoidCallback? onNavigateToBookmarks;
  final VoidCallback? onNavigateToSettings;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final FilePickerService _filePickerService = FilePickerService();
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _importPdf() async {
    final repository = context.read<LibraryRepository>();
    final result = await _filePickerService.pickPdf();

    switch (result) {
      case PickPdfCancelled():
        return;
      case PickPdfFailure(:final message):
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
      case PickPdfSuccess(:final path, :final name, :final sizeBytes):
        final doc = await repository.addOrGetDocument(
          filePath: path,
          name: name,
          sizeBytes: sizeBytes,
        );
        if (!mounted) return;
        _openDocument(doc);
    }
  }

  void _openDocument(PdfDocumentMeta document) {
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
    final repository = context.watch<LibraryRepository>();

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            const PaperKitMark(size: 30),
            const SizedBox(width: 10),
            const Text('PaperKit'),
          ],
        ),
        actions: [
          IconButton(
            tooltip: repository.viewMode == LibraryViewMode.grid
                ? 'Switch to list view'
                : 'Switch to grid view',
            icon: Icon(
              repository.viewMode == LibraryViewMode.grid
                  ? Icons.view_list_rounded
                  : Icons.grid_view_rounded,
            ),
            onPressed: () => repository.setViewMode(
              repository.viewMode == LibraryViewMode.grid
                  ? LibraryViewMode.list
                  : LibraryViewMode.grid,
            ),
          ),
          SortMenuButton(
            current: repository.sortOption,
            onChanged: repository.setSortOption,
          ),
        ],
      ),
      body: repository.isLoading
          ? const Center(child: CircularProgressIndicator())
          : CustomScrollView(
        slivers: [
          if (repository.totalCount > 0) ...[
            SliverToBoxAdapter(
              child: HeroHeaderCard(onImport: _importPdf),
            ),
            SliverToBoxAdapter(
              child: QuickActionsGrid(
                onImport: _importPdf,
                onFavoritesTap: () => widget.onNavigateToFavorites?.call(),
                onBookmarksTap: () => widget.onNavigateToBookmarks?.call(),
                onSettingsTap: () => widget.onNavigateToSettings?.call(),
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: 16)),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: TextField(
                  controller: _searchController,
                  onChanged: repository.setSearchQuery,
                  decoration: InputDecoration(
                    hintText: 'Search documents by name...',
                    prefixIcon: const Icon(Icons.search_rounded),
                    suffixIcon: repository.searchQuery.isEmpty
                        ? null
                        : IconButton(
                      icon: const Icon(Icons.clear_rounded),
                      tooltip: 'Clear search',
                      onPressed: () {
                        _searchController.clear();
                        repository.setSearchQuery('');
                      },
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                    isDense: true,
                  ),
                ),
              ),
            ),
          ],
          if (repository.searchQuery.isEmpty &&
              repository.recentDocuments.isNotEmpty) ...[
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 20, 16, 10),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Recent Reading',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                    ),
                    TextButton(
                      onPressed: repository.clearAllRecent,
                      child: const Text('Clear'),
                    ),
                  ],
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: SizedBox(
                height: 186,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: repository.recentDocuments.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 12),
                  itemBuilder: (context, index) {
                    final doc = repository.recentDocuments[index];
                    return SizedBox(
                      width: 130,
                      child: DocumentGridTile(
                        document: doc,
                        onTap: () => _openDocument(doc),
                        onLongPress: () => FileDetailsSheet.show(context, doc),
                        onToggleFavorite: () =>
                            repository.toggleFavorite(doc.id),
                      ),
                    );
                  },
                ),
              ),
            ),
          ],
          if (repository.totalCount > 0)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 20, 16, 12),
                child: Row(
                  children: [
                    Text(
                      repository.searchQuery.isEmpty
                          ? 'All Documents'
                          : 'Search Results',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.primaryLight.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        '${repository.allDocuments.length}',
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          color: AppColors.primaryLight,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (repository.totalCount == 0)
            SliverFillRemaining(
              hasScrollBody: false,
              child: LibraryEmptyState(onImport: _importPdf),
            )
          else if (repository.allDocuments.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: LibraryNoResultsState(query: repository.searchQuery),
            )
          else if (repository.viewMode == LibraryViewMode.grid)
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 96),
                sliver: SliverGrid(
                  gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                    maxCrossAxisExtent: 180,
                    mainAxisSpacing: 12,
                    crossAxisSpacing: 12,
                    childAspectRatio: 0.72,
                  ),
                  delegate: SliverChildBuilderDelegate(
                        (context, index) {
                      final doc = repository.allDocuments[index];
                      return DocumentGridTile(
                        document: doc,
                        onTap: () => _openDocument(doc),
                        onLongPress: () => FileDetailsSheet.show(context, doc),
                        onToggleFavorite: () =>
                            repository.toggleFavorite(doc.id),
                      );
                    },
                    childCount: repository.allDocuments.length,
                  ),
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.only(bottom: 96),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                        (context, index) {
                      final doc = repository.allDocuments[index];
                      return DocumentListTile(
                        document: doc,
                        onTap: () => _openDocument(doc),
                        onLongPress: () => FileDetailsSheet.show(context, doc),
                        onToggleFavorite: () =>
                            repository.toggleFavorite(doc.id),
                      );
                    },
                    childCount: repository.allDocuments.length,
                  ),
                ),
              ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _importPdf,
        backgroundColor: AppColors.primaryLight,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_rounded),
        label: const Text(
          'Open PDF',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}