import 'package:flutter/material.dart';

import '../../../core/constants/app_colors.dart';
import '../../../models/pdf_document_meta.dart';
import '../../../utils/date_format.dart';
import '../../../utils/file_size_format.dart';

class DocumentGridTile extends StatelessWidget {
  const DocumentGridTile({
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

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
        borderRadius: BorderRadius.circular(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: Container(
                color: isDark ? AppColors.surfaceContainerDark : AppColors.surfaceContainerLight,
                child: Stack(
                  children: [
                    Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.picture_as_pdf_rounded,
                            size: 44,
                            color: missing ? Colors.grey : AppColors.pdfRed,
                          ),
                          if (document.pageCount != null) ...[
                            const SizedBox(height: 4),
                            Text(
                              '${document.pageCount} Pages',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                                color: isDark
                                    ? AppColors.textSecondaryDark
                                    : AppColors.textSecondaryLight,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    Positioned(
                      top: 4,
                      right: 4,
                      child: IconButton(
                        icon: Icon(
                          document.isFavorite ? Icons.star_rounded : Icons.star_outline_rounded,
                          color: document.isFavorite ? Colors.amber : Colors.grey,
                          size: 20,
                        ),
                        onPressed: onToggleFavorite,
                      ),
                    ),
                    if (missing)
                      Positioned(
                        left: 8,
                        bottom: 8,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppColors.error,
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: const Text(
                            'Missing',
                            style: TextStyle(fontSize: 10, color: Colors.white, fontWeight: FontWeight.bold),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            if (document.hasReadingProgress)
              LinearProgressIndicator(
                value: document.readingProgressPercentage,
                minHeight: 3,
                backgroundColor: Colors.grey.withOpacity(0.2),
                valueColor: const AlwaysStoppedAnimation<Color>(AppColors.primaryLight),
              ),
            Padding(
              padding: const EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    document.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${formatFileSize(document.sizeBytes)} · ${formatFriendlyDate(document.addedAt)}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 11,
                      color: isDark ? AppColors.textSecondaryDark : AppColors.textSecondaryLight,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
