import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/constants/app_colors.dart';
import '../../models/pdf_document_meta.dart';
import '../../repositories/library_repository.dart';
import '../../utils/date_format.dart';
import '../../utils/file_size_format.dart';
import '../../widgets/confirm_delete_dialog.dart';
import '../viewer/pdf_viewer_screen.dart';

class FileDetailsSheet extends StatelessWidget {
  const FileDetailsSheet({super.key, required this.document});

  final PdfDocumentMeta document;

  static void show(BuildContext context, PdfDocumentMeta document) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => FileDetailsSheet(document: document),
    );
  }

  Future<void> _rename(BuildContext context) async {
    final controller = TextEditingController(text: document.name);
    final newName = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Rename Document'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Document Name'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (newName != null && newName.isNotEmpty && context.mounted) {
      await context.read<LibraryRepository>().renameDocument(document.id, newName);
      if (context.mounted) Navigator.pop(context);
    }
  }

  Future<void> _share(BuildContext context) async {
    try {
      final xfile = XFile(document.filePath);
      await Share.shareXFiles([xfile], text: 'Sharing ${document.name}');
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to share file.')),
        );
      }
    }
  }

  Future<void> _delete(BuildContext context) async {
    final confirmed = await ConfirmDeleteDialog.show(context, fileName: document.name);
    if (confirmed == true && context.mounted) {
      await context.read<LibraryRepository>().removeDocument(document.id);
      if (context.mounted) Navigator.pop(context);
    }
  }

  void _open(BuildContext context) {
    Navigator.pop(context);
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => PdfViewerScreen(document: document)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<LibraryRepository>();
    final currentDoc = repo.byId(document.id) ?? document;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
        top: 16,
        left: 20,
        right: 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
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
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: AppColors.pdfRed.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.picture_as_pdf_rounded,
                  color: AppColors.pdfRed,
                  size: 28,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      currentDoc.name,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      formatFileSize(currentDoc.sizeBytes),
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
              IconButton(
                icon: Icon(
                  currentDoc.isFavorite ? Icons.star_rounded : Icons.star_outline_rounded,
                  color: currentDoc.isFavorite ? Colors.amber : null,
                ),
                onPressed: () => repo.toggleFavorite(currentDoc.id),
              ),
            ],
          ),
          const SizedBox(height: 20),
          if (currentDoc.hasReadingProgress) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Reading Progress',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: isDark
                              ? AppColors.textSecondaryDark
                              : AppColors.textSecondaryLight,
                        ),
                      ),
                      Text(
                        'Page ${currentDoc.lastPage} of ${currentDoc.pageCount ?? "?"}',
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: currentDoc.readingProgressPercentage,
                      minHeight: 6,
                      backgroundColor: Colors.grey.withOpacity(0.2),
                      valueColor: const AlwaysStoppedAnimation<Color>(
                        AppColors.primaryLight,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],
          _DetailRow(
            icon: Icons.tag_rounded,
            label: 'Page Count',
            value: currentDoc.pageCount != null ? '${currentDoc.pageCount} pages' : 'Unknown',
          ),
          _DetailRow(
            icon: Icons.calendar_today_rounded,
            label: 'Added Date',
            value: formatFriendlyDate(currentDoc.addedAt),
          ),
          if (currentDoc.lastOpenedAt != null)
            _DetailRow(
              icon: Icons.history_rounded,
              label: 'Last Opened',
              value: formatFriendlyDate(currentDoc.lastOpenedAt!),
            ),
          _DetailRow(
            icon: Icons.folder_open_rounded,
            label: 'File Path',
            value: currentDoc.filePath,
            trailing: IconButton(
              icon: const Icon(Icons.copy_rounded, size: 18),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: currentDoc.filePath));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('File path copied to clipboard')),
                );
              },
            ),
          ),
          const SizedBox(height: 20),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _rename(context),
                  icon: const Icon(Icons.edit_outlined, size: 18),
                  label: const Text('Rename'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _share(context),
                  icon: const Icon(Icons.share_outlined, size: 18),
                  label: const Text('Share'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: () => _open(context),
                  icon: const Icon(Icons.book_online_rounded, size: 18),
                  label: const Text('Read PDF'),
                ),
              ),
              const SizedBox(width: 10),
              IconButton(
                style: IconButton.styleFrom(
                  backgroundColor: AppColors.error.withOpacity(0.12),
                  foregroundColor: AppColors.error,
                  padding: const EdgeInsets.all(14),
                ),
                icon: const Icon(Icons.delete_outline_rounded),
                onPressed: () => _delete(context),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.icon,
    required this.label,
    required this.value,
    this.trailing,
  });

  final IconData icon;
  final String label;
  final String value;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(
            icon,
            size: 18,
            color: isDark ? AppColors.textSecondaryDark : AppColors.textSecondaryLight,
          ),
          const SizedBox(width: 10),
          Text(
            label,
            style: TextStyle(
              fontSize: 13,
              color: isDark ? AppColors.textSecondaryDark : AppColors.textSecondaryLight,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}
