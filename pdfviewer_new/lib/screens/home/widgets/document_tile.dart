import 'package:flutter/material.dart';

import '../../../models/pdf_document_meta.dart';
import '../../../utils/date_format.dart';
import '../../../utils/file_size_format.dart';

/// Grid presentation of a library entry: a large placeholder "cover" (real
/// thumbnails land in a later phase) with name/size/date below.
class DocumentGridTile extends StatelessWidget {
  const DocumentGridTile({
    super.key,
    required this.document,
    required this.onTap,
    required this.onToggleFavorite,
  });

  final PdfDocumentMeta document;
  final VoidCallback onTap;
  final VoidCallback onToggleFavorite;

  @override
  Widget build(BuildContext context) {
    final missing = !document.existsOnDisk;
    return Semantics(
      button: true,
      label: '${document.name}, ${formatFileSize(document.sizeBytes)}'
          '${missing ? ', file unavailable' : ''}',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Card(
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: Container(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  child: Stack(
                    children: [
                      Center(
                        child: Icon(
                          Icons.picture_as_pdf,
                          size: 48,
                          color: missing
                              ? Theme.of(context).disabledColor
                              : Theme.of(context).colorScheme.primary,
                        ),
                      ),
                      Positioned(
                        top: 4,
                        right: 4,
                        child: _FavoriteButton(
                          isFavorite: document.isFavorite,
                          onPressed: onToggleFavorite,
                        ),
                      ),
                      if (missing)
                        const Positioned(
                          left: 4,
                          bottom: 4,
                          child: _UnavailableBadge(),
                        ),
                    ],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      document.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${formatFileSize(document.sizeBytes)} · '
                      '${formatFriendlyDate(document.addedAt)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// List presentation of a library entry.
class DocumentListTile extends StatelessWidget {
  const DocumentListTile({
    super.key,
    required this.document,
    required this.onTap,
    required this.onToggleFavorite,
  });

  final PdfDocumentMeta document;
  final VoidCallback onTap;
  final VoidCallback onToggleFavorite;

  @override
  Widget build(BuildContext context) {
    final missing = !document.existsOnDisk;
    final subtitleParts = <String>[
      formatFileSize(document.sizeBytes),
      if (document.pageCount != null) '${document.pageCount} pages',
      formatFriendlyDate(document.addedAt),
    ];
    return ListTile(
      leading: CircleAvatar(
        backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest,
        child: Icon(
          Icons.picture_as_pdf,
          color: missing
              ? Theme.of(context).disabledColor
              : Theme.of(context).colorScheme.primary,
        ),
      ),
      title: Text(document.name, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(
        missing ? 'File unavailable · ${subtitleParts.join(' · ')}' : subtitleParts.join(' · '),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: _FavoriteButton(
        isFavorite: document.isFavorite,
        onPressed: onToggleFavorite,
      ),
      onTap: onTap,
    );
  }
}

class _FavoriteButton extends StatelessWidget {
  const _FavoriteButton({required this.isFavorite, required this.onPressed});

  final bool isFavorite;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onPressed,
      tooltip: isFavorite ? 'Remove from favorites' : 'Add to favorites',
      icon: Icon(
        isFavorite ? Icons.star : Icons.star_border,
        color: isFavorite ? Colors.amber : null,
      ),
    );
  }
}

class _UnavailableBadge extends StatelessWidget {
  const _UnavailableBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.errorContainer,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        'Missing',
        style: TextStyle(
          fontSize: 10,
          color: Theme.of(context).colorScheme.onErrorContainer,
        ),
      ),
    );
  }
}
