import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/constants/app_colors.dart';
import '../../../repositories/bookmarks_repository.dart';

class BookmarkListSheet extends StatelessWidget {
  const BookmarkListSheet({
    super.key,
    required this.documentPath,
    required this.documentName,
    required this.currentPage,
    required this.onJumpToPage,
  });

  final String documentPath;
  final String documentName;
  final int currentPage;
  final ValueChanged<int> onJumpToPage;

  static void show(
    BuildContext context, {
    required String documentPath,
    required String documentName,
    required int currentPage,
    required ValueChanged<int> onJumpToPage,
  }) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => BookmarkListSheet(
        documentPath: documentPath,
        documentName: documentName,
        currentPage: currentPage,
        onJumpToPage: onJumpToPage,
      ),
    );
  }

  Future<void> _addBookmark(BuildContext context) async {
    final titleController = TextEditingController(text: 'Page $currentPage');
    final title = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Add Bookmark (Page $currentPage)'),
        content: TextField(
          controller: titleController,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'Bookmark label'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, titleController.text.trim()),
            child: const Text('Add'),
          ),
        ],
      ),
    );

    if (title != null && context.mounted) {
      await context.read<BookmarksRepository>().addBookmark(
            documentPath: documentPath,
            documentName: documentName,
            pageNumber: currentPage,
            title: title,
          );
    }
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<BookmarksRepository>();
    final bookmarks = repo.forDocument(documentPath);
    final isBookmarked = repo.isBookmarked(documentPath, currentPage);

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.55,
      maxChildSize: 0.85,
      builder: (context, scrollController) {
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          child: Column(
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.grey.withOpacity(0.3),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Bookmarks',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                  TextButton.icon(
                    onPressed: isBookmarked
                        ? () => repo.removeForPage(documentPath, currentPage)
                        : () => _addBookmark(context),
                    icon: Icon(
                      isBookmarked
                          ? Icons.bookmark_remove_rounded
                          : Icons.bookmark_add_rounded,
                      size: 20,
                      color: isBookmarked ? AppColors.error : AppColors.primaryLight,
                    ),
                    label: Text(
                      isBookmarked ? 'Remove Page $currentPage' : 'Bookmark Page $currentPage',
                    ),
                  ),
                ],
              ),
              const Divider(),
              Expanded(
                child: bookmarks.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.bookmark_border_rounded,
                              size: 48,
                              color: Theme.of(context).disabledColor,
                            ),
                            const SizedBox(height: 8),
                            const Text('No bookmarks for this document'),
                          ],
                        ),
                      )
                    : ListView.builder(
                        controller: scrollController,
                        itemCount: bookmarks.length,
                        itemBuilder: (context, index) {
                          final item = bookmarks[index];
                          return ListTile(
                            leading: CircleAvatar(
                              backgroundColor: AppColors.primaryLight.withOpacity(0.12),
                              child: Text(
                                '${item.pageNumber}',
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  color: AppColors.primaryLight,
                                ),
                              ),
                            ),
                            title: Text(item.title),
                            subtitle: Text('Page ${item.pageNumber}'),
                            trailing: IconButton(
                              icon: const Icon(Icons.delete_outline_rounded, size: 20),
                              onPressed: () => repo.removeBookmark(item.id),
                            ),
                            onTap: () {
                              Navigator.pop(context);
                              onJumpToPage(item.pageNumber);
                            },
                          );
                        },
                      ),
              ),
            ],
          ),
        );
      },
    );
  }
}
