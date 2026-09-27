package com.orialthq.ori_beauty.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IncomingImageSignatureTest {
    @Test
    fun detectsSupportedImageSignatures() {
        assertEquals(
            "image/jpeg",
            IncomingImageSignature
                .detect(
                    byteArrayOf(
                        0xff.toByte(),
                        0xd8.toByte(),
                        0xff.toByte(),
                    ),
                )?.mimeType,
        )
        assertEquals(
            "image/png",
            IncomingImageSignature
                .detect(
                    byteArrayOf(
                        0x89.toByte(),
                        0x50,
                        0x4e,
                        0x47,
                        0x0d,
                        0x0a,
                        0x1a,
                        0x0a,
                    ),
                )?.mimeType,
        )
        assertEquals(
            "image/webp",
            IncomingImageSignature
                .detect("RIFF1234WEBP".encodeToByteArray())
                ?.mimeType,
        )
    }

    @Test
    fun rejectsExtensionsAndTruncatedHeadersWithoutMatchingMagicBytes() {
        assertNull(IncomingImageSignature.detect("photo.png".encodeToByteArray()))
        assertNull(IncomingImageSignature.detect("RIFF1234".encodeToByteArray()))
        assertNull(IncomingImageSignature.detect(byteArrayOf()))
    }

    @Test
    fun normalizesKnownMimeAliasesAndParameters() {
        assertEquals(
            "image/jpeg",
            IncomingShareIngestor.normalizeMimeType(" IMAGE/JPG; charset=binary "),
        )
        assertEquals(
            "image/png",
            IncomingShareIngestor.normalizeMimeType("image/x-png"),
        )
        assertEquals(
            "image/webp",
            IncomingShareIngestor.normalizeMimeType("image/webp"),
        )
    }

    @Test
    fun acceptsSupportedImageBytesWhenShareSheetLabelsPngAsJpeg() {
        assertTrue(
            IncomingShareIngestor.isAcceptableImageMimeTypes(
                declaredMimeType = "image/jpeg",
                providerMimeType = "image/png",
                detectedMimeType = "image/png",
            ),
        )
        assertFalse(
            IncomingShareIngestor.isAcceptableImageMimeTypes(
                declaredMimeType = "image/jpeg",
                providerMimeType = "text/plain",
                detectedMimeType = "image/png",
            ),
        )
        assertFalse(
            IncomingShareIngestor.isAcceptableImageMimeTypes(
                declaredMimeType = "image/jpeg",
                providerMimeType = "image/png",
                detectedMimeType = "application/pdf",
            ),
        )
    }

    @Test
    fun stripsRouteDataForAllSupportedImportActions() {
        assertTrue(
            IncomingShareRoutePolicy.shouldStripData("android.intent.action.SEND"),
        )
        assertTrue(
            IncomingShareRoutePolicy.shouldStripData(
                "android.intent.action.SEND_MULTIPLE",
            ),
        )
        assertTrue(
            IncomingShareRoutePolicy.shouldStripData("android.intent.action.VIEW"),
        )
        assertFalse(
            IncomingShareRoutePolicy.shouldStripData("android.intent.action.EDIT"),
        )
        assertFalse(IncomingShareRoutePolicy.shouldStripData(null))
    }
}
