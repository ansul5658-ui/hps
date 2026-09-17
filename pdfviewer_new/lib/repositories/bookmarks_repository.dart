import 'package:flutter/foundation.dart';

import '../models/pdf_bookmark.dart';
import '../storage/bookmarks_store.dart';

class BookmarksRepository extends ChangeNotifier {
  BookmarksRepository({BookmarksStore? store})
      : _store = store ?? BookmarksStore();

  final BookmarksStore _store;
  List<PdfBookmark> _bookmarks = <PdfBookmark>[];
  bool _isLoading = true;

  bool get isLoading => _isLoading;
  List<PdfBookmark> get allBookmarks => List.unmodifiable(_bookmarks);

  Future<void> init() async {
    _bookmarks = await _store.load();
    _isLoading = false;
    notifyListeners();
  }

  List<PdfBookmark> forDocument(String documentPath) {
    return _bookmarks.where((b) => b.documentPath == documentPath).toList()
      ..sort((a, b) => a.pageNumber.compareTo(b.pageNumber));
  }

  bool isBookmarked(String documentPath, int pageNumber) {
    return _bookmarks
        .any((b) => b.documentPath == documentPath && b.pageNumber == pageNumber);
  }

  Future<void> addBookmark({
    required String documentPath,
    required String documentName,
    required int pageNumber,
    required String title,
  }) async {
    final existingIndex = _bookmarks.indexWhere(
      (b) => b.documentPath == documentPath && b.pageNumber == pageNumber,
    );

    final id = DateTime.now().millisecondsSinceEpoch.toString();
    final bookmark = PdfBookmark(
      id: id,
      documentPath: documentPath,
      documentName: documentName,
      pageNumber: pageNumber,
      title: title.isEmpty ? 'Page $pageNumber' : title,
      createdAt: DateTime.now(),
    );

    if (existingIndex >= 0) {
      _bookmarks[existingIndex] = bookmark;
    } else {
      _bookmarks = <PdfBookmark>[..._bookmarks, bookmark];
    }

    await _store.save(_bookmarks);
    notifyListeners();
  }

  Future<void> removeBookmark(String id) async {
    _bookmarks = _bookmarks.where((b) => b.id != id).toList();
    await _store.save(_bookmarks);
    notifyListeners();
  }

  Future<void> removeForPage(String documentPath, int pageNumber) async {
    _bookmarks = _bookmarks
        .where((b) => !(b.documentPath == documentPath && b.pageNumber == pageNumber))
        .toList();
    await _store.save(_bookmarks);
    notifyListeners();
  }

  Future<void> removeForDocument(String documentPath) async {
    _bookmarks = _bookmarks.where((b) => b.documentPath != documentPath).toList();
    await _store.save(_bookmarks);
    notifyListeners();
  }
}
