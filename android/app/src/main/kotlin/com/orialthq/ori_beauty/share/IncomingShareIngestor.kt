package com.orialthq.ori_beauty.share

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.system.Os
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.UUID

class IncomingShareIngestor(context: Context) {
    private val resolver = context.contentResolver
    private val attachmentDirectory =
        File(context.noBackupFilesDir, ATTACHMENT_DIRECTORY_NAME)

    fun ingest(
        intent: Intent?,
        sourcePackage: String?,
    ): IncomingSharePayload? {
        runCatching {
            IncomingShareIntentParser.parse(intent, sourcePackage)
        }.getOrNull()?.let { return it }
        if (intent == null || intent.action !in IMAGE_IMPORT_ACTIONS) {
            return null
        }

        val resolvedMimeType =
            normalizeMimeType(
                runCatching { intent.resolveType(resolver) }.getOrNull(),
            )
        if (
            resolvedMimeType != "image/*" &&
            resolvedMimeType !in SUPPORTED_MIME_TYPES
        ) {
            return null
        }

        val copiedAttachments = mutableListOf<IncomingShareAttachment>()
        return try {
            val imageUris = extractImageUris(intent)
            if (imageUris.isEmpty() || imageUris.size > MAX_ATTACHMENT_COUNT) {
                throw InvalidIncomingImageException()
            }
            var copiedBytes = 0L
            for (uri in imageUris) {
                val remainingTotalBytes = MAX_TOTAL_BYTES - copiedBytes
                if (remainingTotalBytes <= 0L) {
                    throw InvalidIncomingImageException()
                }
                val attachment =
                    copyAndValidate(
                        uri = uri,
                        declaredMimeType = resolvedMimeType,
                        maxBytes = minOf(MAX_ATTACHMENT_BYTES, remainingTotalBytes),
                    )
                copiedAttachments += attachment
                copiedBytes += attachment.byteSize
            }

            val parsedText = IncomingShareIntentParser.parseSharedText(intent)
            IncomingSharePayload(
                id = UUID.randomUUID().toString(),
                receivedAtEpochMs = System.currentTimeMillis(),
                sharedText = parsedText.sharedText,
                discoveredUrl = parsedText.discoveredUrl,
                sourcePackage = sourcePackage,
                mimeType = copiedAttachments.first().mimeType,
                wasTruncated = parsedText.wasTruncated,
                originalLength = parsedText.originalLength,
                shareKind = SHARE_KIND_IMAGE,
                attachments = copiedAttachments,
                sourceImageUris = imageUris,
            )
        } catch (_: InvalidIncomingImageException) {
            deleteAttachments(copiedAttachments)
            null
        } catch (_: SecurityException) {
            deleteAttachments(copiedAttachments)
            null
        } catch (_: RuntimeException) {
            deleteAttachments(copiedAttachments)
            null
        }
    }

    fun deleteAttachments(attachments: Collection<IncomingShareAttachment>) {
        attachments.forEach { attachment ->
            deleteManagedAttachment(attachment.filePath)
        }
    }

    private fun copyAndValidate(
        uri: Uri,
        declaredMimeType: String?,
        maxBytes: Long,
    ): IncomingShareAttachment {
        if (uri.scheme != ContentResolver.SCHEME_CONTENT) {
            throw InvalidIncomingImageException()
        }
        if (!attachmentDirectory.exists() && !attachmentDirectory.mkdirs()) {
            throw InvalidIncomingImageException()
        }

        val providerMimeType = normalizeMimeType(resolver.getType(uri))
        val attachmentId = UUID.randomUUID().toString()
        val temporaryFile = File(attachmentDirectory, ".$attachmentId.part")
        var finalFile: File? = null

        try {
            val copyResult = copyToTemporaryFile(uri, temporaryFile, maxBytes)
            val format =
                IncomingImageSignature.detect(copyResult.header)
                    ?: throw InvalidIncomingImageException()
            validateMimeType(declaredMimeType, providerMimeType, format.mimeType)

            val dimensions = readDimensions(temporaryFile)
            if (
                dimensions.first <= 0 ||
                dimensions.second <= 0 ||
                dimensions.first > MAX_IMAGE_DIMENSION ||
                dimensions.second > MAX_IMAGE_DIMENSION ||
                dimensions.first.toLong() * dimensions.second.toLong() > MAX_IMAGE_PIXELS
            ) {
                throw InvalidIncomingImageException()
            }

            finalFile = File(attachmentDirectory, "$attachmentId.${format.extension}")
            if (finalFile.exists()) {
                throw InvalidIncomingImageException()
            }
            Os.rename(temporaryFile.absolutePath, finalFile.absolutePath)

            return IncomingShareAttachment(
                id = attachmentId,
                filePath = finalFile.absolutePath,
                mimeType = format.mimeType,
                byteSize = copyResult.byteSize,
                width = dimensions.first,
                height = dimensions.second,
                sha256 = copyResult.sha256,
            )
        } catch (error: Exception) {
            temporaryFile.delete()
            finalFile?.delete()
            if (error is InvalidIncomingImageException) {
                throw error
            }
            throw InvalidIncomingImageException()
        }
    }

    private fun copyToTemporaryFile(
        uri: Uri,
        temporaryFile: File,
        maxBytes: Long,
    ): CopiedFile {
        val digest = MessageDigest.getInstance("SHA-256")
        val header = ByteArray(IMAGE_HEADER_BYTES)
        var headerBytes = 0
        var byteSize = 0L

        val input = resolver.openInputStream(uri) ?: throw InvalidIncomingImageException()
        input.use { source ->
            FileOutputStream(temporaryFile).use { destination ->
                val buffer = ByteArray(COPY_BUFFER_BYTES)
                while (true) {
                    val count = source.read(buffer)
                    if (count < 0) {
                        break
                    }
                    if (count == 0) {
                        continue
                    }
                    byteSize += count
                    if (byteSize > maxBytes) {
                        throw InvalidIncomingImageException()
                    }
                    if (headerBytes < header.size) {
                        val headerCopyCount = minOf(count, header.size - headerBytes)
                        buffer.copyInto(
                            destination = header,
                            destinationOffset = headerBytes,
                            startIndex = 0,
                            endIndex = headerCopyCount,
                        )
                        headerBytes += headerCopyCount
                    }
                    digest.update(buffer, 0, count)
                    destination.write(buffer, 0, count)
                }
                destination.flush()
                destination.fd.sync()
            }
        }
        if (byteSize <= 0L) {
            throw InvalidIncomingImageException()
        }

        return CopiedFile(
            byteSize = byteSize,
            header = header.copyOf(headerBytes),
            sha256 =
                digest
                    .digest()
                    .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) },
        )
    }

    private fun readDimensions(file: File): Pair<Int, Int> {
        val options =
            BitmapFactory.Options().apply {
                inJustDecodeBounds = true
            }
        BitmapFactory.decodeFile(file.absolutePath, options)
        return options.outWidth to options.outHeight
    }

    private fun validateMimeType(
        declaredMimeType: String?,
        providerMimeType: String?,
        detectedMimeType: String,
    ) {
        if (!isAcceptableImageMimeTypes(declaredMimeType, providerMimeType, detectedMimeType)) {
            throw InvalidIncomingImageException()
        }
    }

    @Suppress("DEPRECATION")
    private fun extractImageUris(intent: Intent): List<Uri> {
        val candidates =
            when (intent.action) {
                Intent.ACTION_SEND ->
                    listOfNotNull(intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri)
                Intent.ACTION_SEND_MULTIPLE ->
                    intent
                        .getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
                        .orEmpty()
                Intent.ACTION_VIEW -> listOfNotNull(intent.data)
                else -> emptyList()
            }.toMutableList()

        if (candidates.isEmpty()) {
            val clipData = intent.clipData
            if (clipData != null) {
                if (clipData.itemCount > MAX_ATTACHMENT_COUNT) {
                    throw InvalidIncomingImageException()
                }
                for (index in 0 until clipData.itemCount) {
                    clipData.getItemAt(index).uri?.let(candidates::add)
                }
            }
        }
        if (candidates.size > MAX_ATTACHMENT_COUNT) {
            throw InvalidIncomingImageException()
        }

        return candidates.distinctBy(Uri::toString)
    }

    private fun deleteManagedAttachment(filePath: String) {
        val root = runCatching { attachmentDirectory.canonicalFile }.getOrNull() ?: return
        val file = runCatching { File(filePath).canonicalFile }.getOrNull() ?: return
        if (file.parentFile == root) {
            file.delete()
        }
    }

    private data class CopiedFile(
        val byteSize: Long,
        val header: ByteArray,
        val sha256: String,
    )

    private class InvalidIncomingImageException : Exception()

    companion object {
        const val ATTACHMENT_DIRECTORY_NAME = "incoming_share_attachments"
        const val MAX_ATTACHMENT_COUNT = 8
        const val MAX_ATTACHMENT_BYTES = 12L * 1024L * 1024L
        const val MAX_TOTAL_BYTES = 60L * 1024L * 1024L
        const val MAX_IMAGE_DIMENSION = 20_000
        const val MAX_IMAGE_PIXELS = 100_000_000L

        private const val IMAGE_HEADER_BYTES = 12
        private const val COPY_BUFFER_BYTES = 64 * 1024

        private val IMAGE_IMPORT_ACTIONS =
            setOf(
                Intent.ACTION_SEND,
                Intent.ACTION_SEND_MULTIPLE,
                Intent.ACTION_VIEW,
            )
        private val SUPPORTED_MIME_TYPES =
            setOf("image/jpeg", "image/png", "image/webp")

        internal fun normalizeMimeType(value: String?): String? {
            val normalized =
                value
                    ?.substringBefore(';')
                    ?.trim()
                    ?.lowercase()
                    ?.takeIf(String::isNotBlank)
            return when (normalized) {
                "image/jpg", "image/pjpeg" -> "image/jpeg"
                "image/x-png" -> "image/png"
                else -> normalized
            }
        }

        // Share sheets can advertise JPEG for a PNG stream. The signature and
        // decoded dimensions determine the stored format; metadata only needs
        // to describe a supported image type.
        internal fun isAcceptableImageMimeTypes(
            declaredMimeType: String?,
            providerMimeType: String?,
            detectedMimeType: String,
        ): Boolean =
            detectedMimeType in SUPPORTED_MIME_TYPES &&
                (declaredMimeType == null ||
                    declaredMimeType == "image/*" ||
                    declaredMimeType in SUPPORTED_MIME_TYPES) &&
                (providerMimeType == null ||
                    providerMimeType == "image/*" ||
                    providerMimeType in SUPPORTED_MIME_TYPES)
    }
}
