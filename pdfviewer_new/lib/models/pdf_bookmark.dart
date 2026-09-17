class PdfBookmark {
  const PdfBookmark({
    required this.id,
    required this.documentPath,
    required this.documentName,
    required this.pageNumber,
    required this.title,
    required this.createdAt,
  });

  final String id;
  final String documentPath;
  final String documentName;
  final int pageNumber;
  final String title;
  final DateTime createdAt;

  factory PdfBookmark.fromJson(Map<String, dynamic> json) {
    return PdfBookmark(
      id: json['id'] as String,
      documentPath: json['documentPath'] as String,
      documentName: json['documentName'] as String,
      pageNumber: json['pageNumber'] as int,
      title: json['title'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'documentPath': documentPath,
        'documentName': documentName,
        'pageNumber': pageNumber,
        'title': title,
        'createdAt': createdAt.toIso8601String(),
      };
}
