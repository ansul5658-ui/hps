import 'package:flutter/foundation.dart';

import '../models/pdf_document_meta.dart';
import '../models/sort_option.dart';
import '../models/view_mode.dart';
import '../services/pdf_metadata_service.dart';
import '../storage/library_store.dart';

class LibraryRepository extends ChangeNotifier {
  LibraryRepository({LibraryStore? store, PdfMetadataService? metadataService})
      : _store = store ?? LibraryStore(),
        _metadataService = metadataService ?? PdfMetadataService();

  final LibraryStore _store;
  final PdfMetadataService _metadataService;

  List<PdfDocumentMeta> _documents = <PdfDocumentMeta>[];
  String _searchQuery = '';
  SortOption _sortOption = SortOption.recentlyOpened;
  LibraryViewMode _viewMode = LibraryViewMode.grid;
  bool _isLoading = true;

  bool get isLoading => _isLoading;
  String get searchQuery => _searchQuery;
  SortOption get sortOption => _sortOption;
  LibraryViewMode get viewMode => _viewMode;
  int get totalCount => _documents.length;

  Future<void> init() async {
    _documents = await _store.load();
    _isLoading = false;
    notifyListeners();
  }

  List<PdfDocumentMeta> get allDocuments => _applySearchAndSort(_documents);

  List<PdfDocumentMeta> get recentDocuments {
    final recents = _documents.where((d) => d.lastOpenedAt != null).toList()
      ..sort((a, b) => b.lastOpenedAt!.compareTo(a.lastOpenedAt!));
    return recents;
  }

  List<PdfDocumentMeta> get favoriteDocuments =>
      _applySearchAndSort(_documents.where((d) => d.isFavorite).toList());

  PdfDocumentMeta? byId(String id) {
    for (final doc in _documents) {
      if (doc.id == id) return doc;
    }
    return null;
  }

  List<PdfDocumentMeta> _applySearchAndSort(List<PdfDocumentMeta> docs) {
    var result = docs;
    final query = _searchQuery.trim().toLowerCase();
    if (query.isNotEmpty) {
      result = result.where((d) => d.name.toLowerCase().contains(query)).toList();
    }
    result = List<PdfDocumentMeta>.of(result);
    switch (_sortOption) {
      case SortOption.nameAZ:
        result.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
        break;
      case SortOption.nameZA:
        result.sort((a, b) => b.name.toLowerCase().compareTo(a.name.toLowerCase()));
        break;
      case SortOption.recentlyOpened:
        result.sort((a, b) {
          final aTime = a.lastOpenedAt ?? a.addedAt;
          final bTime = b.lastOpenedAt ?? b.addedAt;
          return bTime.compareTo(aTime);
        });
        break;
      case SortOption.recentlyModified:
        result.sort((a, b) => b.addedAt.compareTo(a.addedAt));
        break;
      case SortOption.fileSizeLargest:
        result.sort((a, b) => b.sizeBytes.compareTo(a.sizeBytes));
        break;
      case SortOption.favoritesFirst:
        result.sort((a, b) {
          if (a.isFavorite == b.isFavorite) {
            return a.name.toLowerCase().compareTo(b.name.toLowerCase());
          }
          return a.isFavorite ? -1 : 1;
        });
        break;
    }
    return result;
  }

  void setSearchQuery(String query) {
    if (_searchQuery == query) return;
    _searchQuery = query;
    notifyListeners();
  }

  void setSortOption(SortOption option) {
    if (_sortOption == option) return;
    _sortOption = option;
    notifyListeners();
  }

  void setViewMode(LibraryViewMode mode) {
    if (_viewMode == mode) return;
    _viewMode = mode;
    notifyListeners();
  }

  Future<PdfDocumentMeta> addOrGetDocument({
    required String filePath,
    required String name,
    required int sizeBytes,
  }) async {
    final existing = byId(filePath);
    if (existing != null) return existing;

    var doc = PdfDocumentMeta(
      filePath: filePath,
      name: name,
      sizeBytes: sizeBytes,
      addedAt: DateTime.now(),
    );

    _documents = <PdfDocumentMeta>[..._documents, doc];
    await _persist();
    notifyListeners();

    // Async extract metadata
    _extractMetadataAsync(filePath);

    return doc;
  }

  Future<void> _extractMetadataAsync(String filePath) async {
    final meta = await _metadataService.extractMetadata(filePath);
    if (meta != null) {
      _documents = _documents.map((d) {
        if (d.filePath != filePath) return d;
        return d.copyWith(
          pageCount: meta.pageCount,
          title: meta.title,
          author: meta.author,
        );
      }).toList();
      await _persist();
      notifyListeners();
    }
  }

  Future<void> recordOpened(
    String id, {
    int? page,
    double? offsetX,
    double? offsetY,
    int? pageCount,
  }) async {
    _documents = _documents.map((d) {
      if (d.id != id) return d;
      return d.copyWith(
        lastOpenedAt: DateTime.now(),
        lastPage: page,
        lastOffsetX: offsetX,
        lastOffsetY: offsetY,
        pageCount: pageCount ?? d.pageCount,
      );
    }).toList();
    await _persist();
    notifyListeners();
  }

  Future<void> toggleFavorite(String id) async {
    _documents = _documents.map((d) {
      if (d.id != id) return d;
      return d.copyWith(isFavorite: !d.isFavorite);
    }).toList();
    await _persist();
    notifyListeners();
  }

  Future<void> renameDocument(String id, String newName) async {
    _documents = _documents.map((d) {
      if (d.id != id) return d;
      return d.copyWith(name: newName);
    }).toList();
    await _persist();
    notifyListeners();
  }

  Future<void> removeFromRecent(String id) async {
    _documents = _documents.map((d) {
      if (d.id != id) return d;
      return d.withoutRecentState();
    }).toList();
    await _persist();
    notifyListeners();
  }

  Future<void> clearAllRecent() async {
    _documents = _documents.map((d) => d.withoutRecentState()).toList();
    await _persist();
    notifyListeners();
  }

  Future<void> removeDocument(String id) async {
    _documents = _documents.where((d) => d.id != id).toList();
    await _persist();
    notifyListeners();
  }

  Future<void> _persist() => _store.save(_documents);
}
