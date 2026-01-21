/// AWCMS Mobile - Blog Detail Screen
///
/// Blog detail page from local database.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:intl/intl.dart';

import '../../../core/extensions/context_extensions.dart';
import '../providers/blogs_provider.dart';

class BlogDetailScreen extends ConsumerWidget {
  final String blogId;

  const BlogDetailScreen({super.key, required this.blogId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final blogAsync = ref.watch(blogDetailProvider(blogId));
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      body: blogAsync.when(
        data: (blog) {
          if (blog == null) {
            return Center(child: Text(context.l10n.blogNotFound));
          }

          final coverImage = blog.coverImage;
          final title = blog.title;
          final content = blog.content ?? '';
          final createdAt = blog.createdAt;

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
                        const Spacer(),
                        if (createdAt != null)
                          Text(
                            _formatDate(context, createdAt),
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
                context.l10n.failedToLoadBlogs,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 16),
              FilledButton.tonal(
                onPressed: () => ref.invalidate(blogDetailProvider(blogId)),
                child: Text(context.l10n.retry),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _formatDate(BuildContext context, DateTime date) {
    return DateFormat.yMMMd(
      Localizations.localeOf(context).toString(),
    ).format(date);
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
