import 'package:flutter/material.dart';

import '../../../core/constants/app_colors.dart';
import '../../../models/pdf_document_meta.dart';
import '../../../utils/date_format.dart';
import '../../../utils/file_size_format.dart';

class DocumentListTile extends StatelessWidget {
  const DocumentListTile({
    super.key,
    required this.document,
    required this.onTap,
    required this.onLongPress,
    required this.onToggleFavorite,
  });

  final PdfDocumentMeta document;
  final VoidCallback onTap;
  final VoidCallback onLongPress;
  final VoidCallback onToggleFavorite;

  @override
  Widget build(BuildContext context) {
    final missing = !document.existsOnDisk;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    final subtitleParts = <String>[
      formatFileSize(document.sizeBytes),
      if (document.pageCount != null) '${document.pageCount} pages',
      formatFriendlyDate(document.addedAt),
    ];

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Material(
        color: isDark ? AppColors.cardDark : AppColors.cardLight,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(
            color: isDark ? AppColors.borderDark : AppColors.borderLight,
          ),
        ),
        child: ListTile(
          onTap: onTap,
          onLongPress: onLongPress,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          leading: Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: missing
                  ? Colors.grey.withValues(alpha: 0.12)
                  : AppColors.pdfRed.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(
              Icons.picture_as_pdf_rounded,
              color: missing ? Colors.grey : AppColors.pdfRed,
              size: 24,
            ),
          ),
          title: Text(
            document.name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
          ),
          subtitle: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 2),
              Text(
                missing
                    ? 'Unavailable · ${subtitleParts.join(' · ')}'
                    : subtitleParts.join(' · '),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12,
                  color: isDark
                      ? AppColors.textSecondaryDark
                      : AppColors.textSecondaryLight,
                ),
              ),
              if (document.hasReadingProgress) ...[
                const SizedBox(height: 6),
                ClipRRect(
                  borderRadius: BorderRadius.circular(2),
                  child: LinearProgressIndicator(
                    value: document.readingProgressPercentage,
                    minHeight: 3,
                    backgroundColor: Colors.grey.withValues(alpha: 0.2),
                    valueColor: const AlwaysStoppedAnimation<Color>(
                      AppColors.primaryLight,
                    ),
                  ),
                ),
              ],
            ],
          ),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconButton(
                icon: Icon(
                  document.isFavorite ? Icons.star_rounded : Icons.star_outline_rounded,
                  color: document.isFavorite ? Colors.amber : Colors.grey,
                  size: 22,
                ),
                onPressed: onToggleFavorite,
              ),
              IconButton(
                icon: const Icon(Icons.more_vert_rounded, size: 20),
                onPressed: onLongPress,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
