import 'dart:io';
import 'package:syncfusion_flutter_pdf/pdf.dart';

class PdfMetadata {
  const PdfMetadata({
    required this.pageCount,
    this.title,
    this.author,
  });

  final int pageCount;
  final String? title;
  final String? author;
}

class PdfMetadataService {
  Future<PdfMetadata?> extractMetadata(String filePath) async {
    try {
      final file = File(filePath);
      if (!await file.exists()) return null;
      final bytes = await file.readAsBytes();
      final document = PdfDocument(inputBytes: bytes);
      final count = document.pages.count;
      final info = document.documentInformation;
      final title = info.title.trim().isNotEmpty ? info.title.trim() : null;
      final author = info.author.trim().isNotEmpty ? info.author.trim() : null;
      document.dispose();
      return PdfMetadata(pageCount: count, title: title, author: author);
    } catch (_) {
      return null;
    }
  }
}
