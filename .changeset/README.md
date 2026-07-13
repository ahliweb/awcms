# Changesets

Folder ini dikelola oleh [Changesets](https://github.com/changesets/changesets) untuk versioning dan pembuatan CHANGELOG AWCMS.

## Cara pakai singkat

1. Setelah membuat perubahan yang mempengaruhi perilaku, tambahkan changeset:

   ```bash
   bun run changeset
   ```

   Pilih tingkat bump (**patch/minor/major**) dan tulis ringkasan perubahan. File markdown baru muncul di `.changeset/`.

2. Saat rilis, konsumsi semua changeset untuk menaikkan versi dan memperbarui `CHANGELOG.md`:

   ```bash
   bun run changeset:version
   ```

Perubahan docs-only/chore tidak wajib menyertakan changeset.
