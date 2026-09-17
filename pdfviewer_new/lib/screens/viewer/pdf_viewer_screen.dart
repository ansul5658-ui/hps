import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:syncfusion_flutter_pdfviewer/pdfviewer.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../../core/constants/app_colors.dart';
import '../../models/pdf_document_meta.dart';
import '../../repositories/bookmarks_repository.dart';
import '../../repositories/library_repository.dart';
import '../details/file_details_sheet.dart';
import 'widgets/bookmark_list_sheet.dart';
import 'widgets/in_doc_search_bar.dart';

class PdfViewerScreen extends StatefulWidget {
  const PdfViewerScreen({super.key, required this.document});

  final PdfDocumentMeta document;

  @override
  State<PdfViewerScreen> createState() => _PdfViewerScreenState();
}

class _PdfViewerScreenState extends State<PdfViewerScreen> {
  final PdfViewerController _pdfController = PdfViewerController();
  late PdfTextSearchResult _searchResult;

  int _currentPage = 1;
  int _totalPages = 0;
  bool _isSearching = false;
  bool _isNightMode = false;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _searchResult = PdfTextSearchResult();
    _searchResult.addListener(_onSearchListener);
    WakelockPlus.enable();
  }

  void _onSearchListener() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    WakelockPlus.disable();
    _searchResult.removeListener(_onSearchListener);
    _pdfController.dispose();
    super.dispose();
  }

  void _performSearch(String query) {
    final result = _pdfController.searchText(query);
    if (mounted) {
      setState(() {
        _searchResult = result;
      });
    }
  }

  void _saveProgress() {
    if (_totalPages == 0) return;
    context.read<LibraryRepository>().recordOpened(
          widget.document.id,
          page: _pdfController.pageNumber,
          offsetX: _pdfController.scrollOffset.dx,
          offsetY: _pdfController.scrollOffset.dy,
          pageCount: _totalPages,
        );
  }

  Future<void> _showJumpToPageDialog() async {
    if (_totalPages <= 0) return;
    final textController = TextEditingController(text: _currentPage.toString());

    final target = await showDialog<int>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Jump to Page'),
        content: TextField(
          controller: textController,
          keyboardType: TextInputType.number,
          autofocus: true,
          decoration: InputDecoration(
            hintText: 'Page 1 - $_totalPages',
            labelText: 'Page Number',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final val = int.tryParse(textController.text.trim());
              Navigator.pop(dialogContext, val);
            },
            child: const Text('Go'),
          ),
        ],
      ),
    );

    if (target != null && target >= 1 && target <= _totalPages) {
      _pdfController.jumpToPage(target);
    }
  }

  void _zoomIn() {
    _pdfController.zoomLevel = (_pdfController.zoomLevel + 0.25).clamp(1.0, 3.0);
  }

  void _zoomOut() {
    _pdfController.zoomLevel = (_pdfController.zoomLevel - 0.25).clamp(1.0, 3.0);
  }

  @override
  Widget build(BuildContext context) {
    final resumePage = widget.document.hasReadingProgress
        ? widget.document.lastPage!
        : 1;

    final bookmarksRepo = context.watch<BookmarksRepository>();
    final isCurrentBookmarked = bookmarksRepo.isBookmarked(
      widget.document.filePath,
      _currentPage,
    );

    return Scaffold(
      backgroundColor: _isNightMode ? const Color(0xFF121212) : null,
      appBar: AppBar(
        title: Text(
          widget.document.name,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          IconButton(
            icon: Icon(_isSearching ? Icons.search_off_rounded : Icons.search_rounded),
            tooltip: 'Search text',
            onPressed: () {
              setState(() {
                _isSearching = !_isSearching;
                if (!_isSearching) _searchResult.clear();
              });
            },
          ),
          IconButton(
            icon: Icon(
              isCurrentBookmarked ? Icons.bookmark_rounded : Icons.bookmark_border_rounded,
              color: isCurrentBookmarked ? AppColors.primaryLight : null,
            ),
            tooltip: 'Bookmarks',
            onPressed: () {
              BookmarkListSheet.show(
                context,
                documentPath: widget.document.filePath,
                documentName: widget.document.name,
                currentPage: _currentPage,
                onJumpToPage: (page) => _pdfController.jumpToPage(page),
              );
            },
          ),
          IconButton(
            icon: Icon(_isNightMode ? Icons.light_mode_rounded : Icons.dark_mode_rounded),
            tooltip: 'Toggle night mode',
            onPressed: () => setState(() => _isNightMode = !_isNightMode),
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert_rounded),
            onSelected: (val) {
              if (val == 'info') {
                FileDetailsSheet.show(context, widget.document);
              } else if (val == 'fit_width') {
                _pdfController.zoomLevel = 1.0;
              }
            },
            itemBuilder: (context) => [
              const PopupMenuItem(
                value: 'fit_width',
                child: Row(
                  children: [
                    Icon(Icons.fit_screen_rounded, size: 20),
                    SizedBox(width: 10),
                    Text('Reset Zoom'),
                  ],
                ),
              ),
              const PopupMenuItem(
                value: 'info',
                child: Row(
                  children: [
                    Icon(Icons.info_outline_rounded, size: 20),
                    SizedBox(width: 10),
                    Text('Document Info'),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          if (_isSearching)
            InDocSearchBar(
              searchResult: _searchResult,
              onSearch: _performSearch,
              onClose: () {
                setState(() {
                  _isSearching = false;
                  _searchResult.clear();
                });
              },
            ),
          Expanded(
            child: _loadError != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.error_outline_rounded, size: 48, color: AppColors.error),
                          const SizedBox(height: 12),
                          Text(
                            _loadError!,
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.bodyMedium,
                          ),
                        ],
                      ),
                    ),
                  )
                : SfPdfViewer.file(
                    File(widget.document.filePath),
                    controller: _pdfController,
                    initialPageNumber: resumePage,
                    initialScrollOffset: Offset(
                      widget.document.lastOffsetX ?? 0,
                      widget.document.lastOffsetY ?? 0,
                    ),
                    onDocumentLoaded: (details) {
                      setState(() {
                        _totalPages = _pdfController.pageCount;
                        _currentPage = _pdfController.pageNumber;
                      });
                      _saveProgress();
                    },
                    onPageChanged: (details) {
                      setState(() {
                        _currentPage = details.newPageNumber;
                      });
                      _saveProgress();
                    },
                    onDocumentLoadFailed: (details) {
                      setState(() {
                        _loadError = details.description.isNotEmpty
                            ? details.description
                            : 'Failed to render PDF document.';
                      });
                    },
                  ),
          ),
        ],
      ),
      bottomNavigationBar: _totalPages == 0
          ? null
          : Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surface,
                border: Border(
                  top: BorderSide(
                    color: Theme.of(context).colorScheme.outline.withValues(alpha: 0.2),
                  ),
                ),
              ),
              child: SafeArea(
                child: Row(
                  children: [
                    IconButton(
                      icon: const Icon(Icons.chevron_left_rounded),
                      tooltip: 'Previous page',
                      onPressed: _currentPage > 1 ? _pdfController.previousPage : null,
                    ),
                    InkWell(
                      onTap: _showJumpToPageDialog,
                      borderRadius: BorderRadius.circular(8),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        child: Text(
                          'Page $_currentPage of $_totalPages',
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                        ),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.chevron_right_rounded),
                      tooltip: 'Next page',
                      onPressed:
                          _currentPage < _totalPages ? _pdfController.nextPage : null,
                    ),
                    const Spacer(),
                    IconButton(
                      icon: const Icon(Icons.zoom_out_rounded, size: 20),
                      tooltip: 'Zoom out',
                      onPressed: _zoomOut,
                    ),
                    IconButton(
                      icon: const Icon(Icons.zoom_in_rounded, size: 20),
                      tooltip: 'Zoom in',
                      onPressed: _zoomIn,
                    ),
                  ],
                ),
              ),
            ),
    );
  }
}
