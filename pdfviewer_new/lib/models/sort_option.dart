enum SortOption { nameAZ, nameZA, recentlyOpened, recentlyModified, fileSizeLargest, favoritesFirst }

extension SortOptionLabel on SortOption {
  String get label {
    switch (this) {
      case SortOption.nameAZ:
        return 'Name (A-Z)';
      case SortOption.nameZA:
        return 'Name (Z-A)';
      case SortOption.recentlyOpened:
        return 'Recently opened';
      case SortOption.recentlyModified:
        return 'Recently added';
      case SortOption.fileSizeLargest:
        return 'File size';
      case SortOption.favoritesFirst:
        return 'Favorites first';
    }
  }
}
