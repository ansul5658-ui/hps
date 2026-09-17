import '../models/pdf_bookmark.dart';
import 'json_file_store.dart';

class BookmarksStore {
  BookmarksStore({JsonFileStore? store})
      : _store = store ?? JsonFileStore('bookmarks.json');

  final JsonFileStore _store;

  Future<List<PdfBookmark>> load() async {
    final raw = await _store.readList();
    final bookmarks = <PdfBookmark>[];
    for (final item in raw) {
      if (item is Map) {
        try {
          bookmarks.add(PdfBookmark.fromJson(Map<String, dynamic>.from(item)));
        } catch (_) {}
      }
    }
    return bookmarks;
  }

  Future<void> save(List<PdfBookmark> bookmarks) async {
    await _store.writeList(bookmarks.map((b) => b.toJson()).toList());
  }
}
