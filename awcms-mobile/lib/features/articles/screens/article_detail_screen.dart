/// AWCMS Mobile - Article Detail Screen
///
/// Halaman detail artikel.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';

import '../providers/articles_provider.dart';

class ArticleDetailScreen extends ConsumerWidget {
  final String articleId;

  const ArticleDetailScreen({super.key, required this.articleId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final articleAsync = ref.watch(articleDetailProvider(articleId));
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      body: articleAsync.when(
        data: (article) {
          if (article == null) {
            return const Center(child: Text('Artikel tidak ditemukan'));
          }

          final coverImage = article['cover_image'] as String?;
          final title = article['title'] as String? ?? 'Untitled';
          final content = article['content'] as String? ?? '';
          final createdAt = article['created_at'] as String?;
          final author = article['author'] as Map<String, dynamic>?;

          return CustomScrollView(
            slivers: [
              // App Bar with Cover Image
              SliverAppBar(
                expandedHeight: coverImage != null ? 250 : 0,
                pinned: true,
                flexibleSpace: coverImage != null
                    ? FlexibleSpaceBar(
                        background: CachedNetworkImage(
                          imageUrl: coverImage,
                          fit: BoxFit.cover,
                          placeholder: (context, url) => Container(
                            color: colorScheme.surfaceContainerHighest,
                          ),
                          errorWidget: (context, url, error) => Container(
                            color: colorScheme.surfaceContainerHighest,
                            child: Icon(
                              Icons.image_not_supported,
                              color: colorScheme.outline,
                            ),
                          ),
                        ),
                      )
                    : null,
              ),

              // Content
              SliverPadding(
                padding: const EdgeInsets.all(16),
                sliver: SliverList(
                  delegate: SliverChildListDelegate([
                    // Title
                    Text(
                      title,
                      style: Theme.of(context).textTheme.headlineSmall
                          ?.copyWith(fontWeight: FontWeight.bold),
                    ),

                    const SizedBox(height: 16),

                    // Meta Info
                    Row(
                      children: [
                        if (author != null) ...[
                          CircleAvatar(
                            radius: 16,
                            backgroundColor: colorScheme.primaryContainer,
                            child: Text(
                              (author['name'] as String? ?? 'A')[0]
                                  .toUpperCase(),
                              style: TextStyle(
                                color: colorScheme.primary,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            author['name'] as String? ?? 'Anonymous',
                            style: Theme.of(context).textTheme.bodyMedium,
                          ),
                        ],
                        const Spacer(),
                        if (createdAt != null)
                          Text(
                            _formatDate(createdAt),
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(color: colorScheme.outline),
                          ),
                      ],
                    ),

                    const Divider(height: 32),

                    // Content (stripped HTML as plain text)
                    Text(
                      _stripHtml(content),
                      style: Theme.of(
                        context,
                      ).textTheme.bodyLarge?.copyWith(height: 1.6),
                    ),

                    const SizedBox(height: 24),
                  ]),
                ),
              ),
            ],
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.error_outline, size: 64, color: colorScheme.error),
              const SizedBox(height: 16),
              Text(
                'Gagal memuat artikel',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 16),
              FilledButton.tonal(
                onPressed: () =>
                    ref.invalidate(articleDetailProvider(articleId)),
                child: const Text('Coba Lagi'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _formatDate(String dateString) {
    try {
      final date = DateTime.parse(dateString);
      final months = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];
      return '${date.day} ${months[date.month - 1]} ${date.year}';
    } catch (_) {
      return dateString;
    }
  }

  String _stripHtml(String html) {
    return html
        .replaceAll(RegExp(r'<[^>]*>'), '')
        .replaceAll('&nbsp;', ' ')
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .trim();
  }
}
