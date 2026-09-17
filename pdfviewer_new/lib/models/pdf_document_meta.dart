import 'dart:io';

/// A single PDF entry tracked by the library. Files are referenced by their
/// real filesystem path rather than copied into app storage.
class PdfDocumentMeta {
  const PdfDocumentMeta({
    required this.filePath,
    required this.name,
    required this.sizeBytes,
    required this.addedAt,
    this.pageCount,
    this.lastOpenedAt,
    this.lastPage,
    this.lastOffsetX,
    this.lastOffsetY,
    this.isFavorite = false,
    this.thumbnailPath,
    this.author,
    this.title,
  });

  final String filePath;
  final String name;
  final int sizeBytes;
  final DateTime addedAt;
  final int? pageCount;
  final DateTime? lastOpenedAt;
  final int? lastPage;
  final double? lastOffsetX;
  final double? lastOffsetY;
  final bool isFavorite;
  final String? thumbnailPath;
  final String? author;
  final String? title;

  String get id => filePath;

  bool get existsOnDisk => File(filePath).existsSync();

  bool get hasReadingProgress => lastPage != null && lastPage! > 1;

  double get readingProgressPercentage {
    if (pageCount == null || pageCount! <= 0 || lastPage == null) return 0.0;
    return (lastPage! / pageCount!).clamp(0.0, 1.0);
  }

  PdfDocumentMeta copyWith({
    String? name,
    int? pageCount,
    DateTime? lastOpenedAt,
    int? lastPage,
    double? lastOffsetX,
    double? lastOffsetY,
    bool? isFavorite,
    String? thumbnailPath,
    String? author,
    String? title,
  }) {
    return PdfDocumentMeta(
      filePath: filePath,
      name: name ?? this.name,
      sizeBytes: sizeBytes,
      addedAt: addedAt,
      pageCount: pageCount ?? this.pageCount,
      lastOpenedAt: lastOpenedAt ?? this.lastOpenedAt,
      lastPage: lastPage ?? this.lastPage,
      lastOffsetX: lastOffsetX ?? this.lastOffsetX,
      lastOffsetY: lastOffsetY ?? this.lastOffsetY,
      isFavorite: isFavorite ?? this.isFavorite,
      thumbnailPath: thumbnailPath ?? this.thumbnailPath,
      author: author ?? this.author,
      title: title ?? this.title,
    );
  }

  PdfDocumentMeta withoutRecentState() {
    return PdfDocumentMeta(
      filePath: filePath,
      name: name,
      sizeBytes: sizeBytes,
      addedAt: addedAt,
      pageCount: pageCount,
      isFavorite: isFavorite,
      thumbnailPath: thumbnailPath,
      author: author,
      title: title,
    );
  }

  factory PdfDocumentMeta.fromJson(Map<String, dynamic> json) {
    return PdfDocumentMeta(
      filePath: json['filePath'] as String,
      name: json['name'] as String,
      sizeBytes: json['sizeBytes'] as int,
      addedAt: DateTime.parse(json['addedAt'] as String),
      pageCount: json['pageCount'] as int?,
      lastOpenedAt: json['lastOpenedAt'] == null
          ? null
          : DateTime.parse(json['lastOpenedAt'] as String),
      lastPage: json['lastPage'] as int?,
      lastOffsetX: (json['lastOffsetX'] as num?)?.toDouble(),
      lastOffsetY: (json['lastOffsetY'] as num?)?.toDouble(),
      isFavorite: json['isFavorite'] as bool? ?? false,
      thumbnailPath: json['thumbnailPath'] as String?,
      author: json['author'] as String?,
      title: json['title'] as String?,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'filePath': filePath,
        'name': name,
        'sizeBytes': sizeBytes,
        'addedAt': addedAt.toIso8601String(),
        'pageCount': pageCount,
        'lastOpenedAt': lastOpenedAt?.toIso8601String(),
        'lastPage': lastPage,
        'lastOffsetX': lastOffsetX,
        'lastOffsetY': lastOffsetY,
        'isFavorite': isFavorite,
        'thumbnailPath': thumbnailPath,
        'author': author,
        'title': title,
      };
}
