import '../models/pdf_document_meta.dart';
import 'json_file_store.dart';

class LibraryStore {
  LibraryStore({JsonFileStore? store}) : _store = store ?? JsonFileStore('library.json');

  final JsonFileStore _store;

  Future<List<PdfDocumentMeta>> load() async {
    final raw = await _store.readList();
    final docs = <PdfDocumentMeta>[];
    for (final item in raw) {
      if (item is Map) {
        try {
          docs.add(PdfDocumentMeta.fromJson(Map<String, dynamic>.from(item)));
        } catch (_) {
          // Skip a corrupt entry rather than failing the whole load.
        }
      }
    }
    return docs;
  }

  Future<void> save(List<PdfDocumentMeta> docs) async {
    await _store.writeList(docs.map((d) => d.toJson()).toList());
  }
}
