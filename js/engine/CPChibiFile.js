/*
    ChickenPaint

    ChickenPaint is a translation of ChibiPaint from Java to JavaScript
    by Nicholas Sherlock / Chicken Smoothie.

    ChibiPaint is Copyright (c) 2006-2008 Marc Schefer

    ChickenPaint is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ChickenPaint is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with ChickenPaint. If not, see <http://www.gnu.org/licenses/>.
*/

import CPArtwork from "./CPArtwork";
import CPImageLayer from "./CPImageLayer";
import CPColorBmp from "./CPColorBmp";
import ArrayDataStream from "../util/ArrayDataStream";
import CPLayerGroup from "./CPLayerGroup";
import CPGreyBmp from "./CPGreyBmp";

/**
 * Concat two Uint8Arrays to make a new one and return it.
 *
 * Either one may be set to null. If either one is null, the other is returned. If both are null, null is
 * returned.
 */
function concatBuffers(one, two) {
    if (one == null || one.length == 0) {
        return two;
    }
    if (two == null || two.length == 0) {
        return one;
    }

    var
        result = new Uint8Array(one.length + two.length);

    result.set(one, 0);
    result.set(two, one.length);

    return result;
}

function CPChibiFileHeader(stream) {
    this.version = stream.readU32BE();
    this.width = stream.readU32BE();
    this.height = stream.readU32BE();
    this.layersNb = stream.readU32BE();
}

CPChibiFileHeader.FIXED_HEADER_LENGTH = 4 * 4;

function ChibiChunkHeader(stream) {
    var
        chunkType = new Array(4);

    for (var i = 0; i < chunkType.length; i++) {
        chunkType[i] = String.fromCharCode(stream.readByte());
    }

    this.chunkType = chunkType.join("");
    this.chunkSize = stream.readU32BE();

    if (stream.eof) {
        throw "Truncated chunk";
    }
}

ChibiChunkHeader.HEADER_LENGTH = 8;

const
    LAYER_FLAG_VISIBLE = 1,
    LAYER_FLAG_CLIP = 2,
    LAYER_FLAG_HAS_MASK = 4,
    LAYER_FLAG_EXPANDED = 8,

    LAYER_DECODE_STATE_FIXED_HEADER    = 0,
    LAYER_DECODE_STATE_VARIABLE_HEADER = 1,
    LAYER_DECODE_STATE_IMAGE_DATA      = 3,
    LAYER_DECODE_STATE_MASK_DATA       = 4,
    LAYER_DECODE_STATE_SKIP_TRAILING   = 5,
    LAYER_DECODE_STATE_COMPLETE        = 6;

/**
 *
 * @param {ChibiChunkHeader} chunkHeader - The header for the layer chunk to decode
 * @param {int} width - The width of the document
 * @param {int} height - The height of the document
 * @constructor
 */
function ChibiLayerDecoder(chunkHeader, width, height) {
    this.chunkHeader = chunkHeader;
    this.width = width;
    this.height = height;

    this.state = LAYER_DECODE_STATE_FIXED_HEADER;
    this.payloadOffset = 0;
    this.skipBytes = 0;
    this.nameLength = 0;
    this.done = false;

    this.colorDecoder = null;
    this.maskDecoder = null;
}

ChibiLayerDecoder.prototype.readFixedHeader = function(stream) {
    this.payloadOffset = stream.readU32BE();

    this.blendMode = stream.readU32BE();
    this.alpha = stream.readU32BE();

    var
        layerFlags = stream.readU32BE();

    this.visible = (layerFlags & LAYER_FLAG_VISIBLE) != 0;
    this.clip = (layerFlags & LAYER_FLAG_CLIP) != 0;
    this.hasMask = (layerFlags & LAYER_FLAG_HAS_MASK) != 0;
    this.expanded = (layerFlags & LAYER_FLAG_EXPANDED) != 0;

    this.nameLength = stream.readU32BE();
};

ChibiLayerDecoder.prototype.getFixedHeaderLen = function() {
    return 5 * 4;
};

ChibiLayerDecoder.prototype.getVariableHeaderLen = function() {
    return this.nameLength;
};

ChibiLayerDecoder.prototype.readVariableSizeHeader = function(stream) {
    this.name = stream.readString(this.nameLength);
};

/**
 * Decode some layer data from the beginning of the given block. Returns any non-layer data
 * that was left over from that block, or null if the block was read completely.
 *
 * Keep calling with more data until the .done property is set to true.
 *
 * @param {Uint8Array} block
 * @returns {?Uint8Array}
 */
ChibiLayerDecoder.prototype.decode = function(block) {
    var
        stream;

    // Dummy loop so we can re-enter the switch statement with "continue"
    while (true) {
        if (this.skipBytes > 0) {
            if (this.skipBytes >= block.length) {
                this.skipBytes -= block.length;
                return null;
            } else {
                block = block.subarray(this.skipBytes);
                this.skipBytes = 0;
            }
        }

        switch (this.state) {
            case LAYER_DECODE_STATE_FIXED_HEADER:
                // Wait for first part of header to arrive
                if (block.length < this.getFixedHeaderLen()) {
                    break;
                }

                stream = new ArrayDataStream(block);
                this.readFixedHeader(stream);

                block = block.subarray(stream.pos);

                this.state = LAYER_DECODE_STATE_VARIABLE_HEADER;
                continue;

            case LAYER_DECODE_STATE_VARIABLE_HEADER:
                // Wait for variable part of header to arrive
                if (block.length < this.getVariableHeaderLen()) {
                    break;
                }

                stream = new ArrayDataStream(block);
                this.readVariableSizeHeader(stream);

                this.layer = this.createLayer();

                if (this.hasMask) {
                    this.layer.setMask(new CPGreyBmp(this.width, this.height, 8));
                    this.maskDecoder = new CPMaskDecoder(this.layer.mask);
                }

                if (this.layer instanceof CPImageLayer) {
                    this.colorDecoder = new CPColorPixelsDecoder(this.layer.image);
                }

                this.skipBytes = this.payloadOffset - this.getFixedHeaderLen();

                if (this.colorDecoder) {
                    this.state = LAYER_DECODE_STATE_IMAGE_DATA;
                } else if (this.maskDecoder) {
                    this.state = LAYER_DECODE_STATE_MASK_DATA;
                } else {
                    this.state = LAYER_DECODE_STATE_SKIP_TRAILING;
                }

                continue;

            case LAYER_DECODE_STATE_IMAGE_DATA:
                block = this.colorDecoder.decode(block);

                if (this.colorDecoder.done) {
                    if (this.maskDecoder) {
                        this.state = LAYER_DECODE_STATE_MASK_DATA;
                    } else {
                        this.state = LAYER_DECODE_STATE_SKIP_TRAILING;
                    }
                    continue;
                }
                break;

            case LAYER_DECODE_STATE_MASK_DATA:
                block = this.maskDecoder.decode(block);

                if (this.maskDecoder.done) {
                    this.state = LAYER_DECODE_STATE_SKIP_TRAILING;
                    continue;
                }
                break;

            case LAYER_DECODE_STATE_SKIP_TRAILING:
                var
                    bytesRead = this.payloadOffset;

                if (this.colorDecoder) {
                    bytesRead += this.colorDecoder.bytesTotal;
                }

                if (this.maskDecoder) {
                    bytesRead += this.maskDecoder.bytesTotal;
                }

                this.state = LAYER_DECODE_STATE_COMPLETE;
                this.skipBytes = this.chunkHeader.chunkSize - bytesRead;
                continue;

            case LAYER_DECODE_STATE_COMPLETE:
                this.done = true;
        }
        break;
    }

    return block;
};

/**
 *
 * @param chunkHeader
 * @param width
 * @param height
 * @constructor
 */
function ChibiImageLayerDecoder(chunkHeader, width, height) {
    ChibiLayerDecoder.call(this, chunkHeader, width, height);
}

ChibiImageLayerDecoder.prototype = Object.create(ChibiLayerDecoder.prototype);
ChibiImageLayerDecoder.prototype.constructor = ChibiImageLayerDecoder;

/**
 * Create a layer using the properties previously read into this decoder.
 *
 * @returns {CPImageLayer}
 */
ChibiImageLayerDecoder.prototype.createLayer = function() {
    var
        layer = new CPImageLayer(this.width, this.height, this.name);

    layer.blendMode = this.blendMode;
    layer.alpha = this.alpha;

    layer.visible = this.visible;
    layer.clip = this.clip;

    return layer;
};

function ChibiLayerGroupDecoder(chunkHeader, width, height) {
    ChibiLayerDecoder.call(this, chunkHeader, width, height);

    this.childLayers = 0;
}

ChibiLayerGroupDecoder.prototype = Object.create(ChibiLayerDecoder.prototype);
ChibiLayerGroupDecoder.prototype.constructor = ChibiLayerGroupDecoder;

ChibiLayerGroupDecoder.prototype.readFixedHeader = function(stream) {
    ChibiLayerDecoder.prototype.readFixedHeader.call(this, stream);

    this.childLayers = stream.readU32BE();
};

ChibiLayerGroupDecoder.prototype.getFixedHeaderLen = function() {
    return ChibiLayerDecoder.prototype.getFixedHeaderLen.call(this) + 4;
};

/**
 * Create a group using the properties previously read into this decoder.
 *
 * @returns {CPLayerGroup}
 */
ChibiLayerGroupDecoder.prototype.createLayer = function() {
    var
        group = new CPLayerGroup(this.name, this.blendMode);

    group.alpha = this.alpha;

    group.visible = this.visible;
    group.expanded = this.expanded;

    return group;
};

/**
 * Write the RGBA pixels of the given bitmap to the stream in ARGB order to match the Chibi specs.
 *
 * @param {ArrayDataStream} stream
 * @param {CPColorBmp} bitmap
 */
function writeColorBitmapToStream(stream, bitmap) {
    var
        pos = stream.pos,
        buffer = stream.data,
        bitmapData = bitmap.data;
    
    for (var i = 0; i < bitmapData.length; i += CPColorBmp.BYTES_PER_PIXEL) {
        buffer[pos++] = bitmapData[i + CPColorBmp.ALPHA_BYTE_OFFSET];
        buffer[pos++] = bitmapData[i + CPColorBmp.RED_BYTE_OFFSET];
        buffer[pos++] = bitmapData[i + CPColorBmp.GREEN_BYTE_OFFSET];
        buffer[pos++] = bitmapData[i + CPColorBmp.BLUE_BYTE_OFFSET];
    }
    
    stream.pos = pos;
}

/**
 * Write the 8-bit greyscale pixels of the given bitmap to the stream.
 *
 * @param {ArrayDataStream} stream
 * @param {CPGreyBmp} bitmap
 */
function writeMaskToStream(stream, bitmap) {
    stream.data.set(stream.pos, bitmap.data.length);
    stream.pos += bitmap.data.length;
}

/**
 *
 * @param {CPColorBmp} destImage - Image to decode into.
 * @constructor
 */
function CPColorPixelsDecoder(destImage) {
    this.bytesRead = 0;
    this.bytesTotal = destImage.width * destImage.height * CPColorBmp.BYTES_PER_PIXEL;
    this.output = destImage.data;
    this.done = false;
}

/**
 * Decode A,R,G,B pixels from the given buffer into the R,G,B,A destination image.
 *
 * Returns the buffer with the read bytes removed from the front, or null if the buffer was read in its entirety.
 *
 * @param {Uint8Array} buffer
 */
CPColorPixelsDecoder.prototype.decode = function(buffer) {
    if (buffer == null) {
        return null;
    }

    var
        subpixel = this.bytesRead % CPColorBmp.BYTES_PER_PIXEL,
        dstPixelStartOffset = this.bytesRead - subpixel,
        bufferPos = 0,

    // Map from source channel order to CPLayer's dest order
        channelMap = [
            CPColorBmp.ALPHA_BYTE_OFFSET,
            CPColorBmp.RED_BYTE_OFFSET,
            CPColorBmp.GREEN_BYTE_OFFSET,
            CPColorBmp.BLUE_BYTE_OFFSET
        ];

    // The first pixel might be a partial one, since we might be continuing a pixel split over buffers
    for (; subpixel < CPColorBmp.BYTES_PER_PIXEL && bufferPos < buffer.length; subpixel++) {
        this.output[dstPixelStartOffset + channelMap[subpixel]] = buffer[bufferPos];
        bufferPos++;
    }

    this.bytesRead += bufferPos;

    // How many more pixels are we to read in this buffer?
    var
        bytesRemain = Math.min(buffer.length - bufferPos, this.bytesTotal - this.bytesRead) | 0,
        fullPixelsRemain = (bytesRemain / CPColorBmp.BYTES_PER_PIXEL) | 0,
        subpixelsRemain = bytesRemain % CPColorBmp.BYTES_PER_PIXEL;

    for (var i = 0; i < fullPixelsRemain; i++) {
        this.output[this.bytesRead + CPColorBmp.ALPHA_BYTE_OFFSET] = buffer[bufferPos];
        this.output[this.bytesRead + CPColorBmp.RED_BYTE_OFFSET] = buffer[bufferPos + 1];
        this.output[this.bytesRead + CPColorBmp.GREEN_BYTE_OFFSET] = buffer[bufferPos + 2];
        this.output[this.bytesRead + CPColorBmp.BLUE_BYTE_OFFSET] = buffer[bufferPos + 3];
        this.bytesRead += CPColorBmp.BYTES_PER_PIXEL;
        bufferPos += CPColorBmp.BYTES_PER_PIXEL;
    }

    // Read a fractional pixel at the end of the buffer
    dstPixelStartOffset = this.bytesRead;
    for (subpixel = 0; subpixel < subpixelsRemain; subpixel++) {
        this.output[dstPixelStartOffset + channelMap[subpixel]] = buffer[bufferPos];
        bufferPos++;
    }

    this.bytesRead += subpixelsRemain;

    if (this.bytesRead >= this.bytesTotal) {
        this.done = true;
    }

    if (bufferPos < buffer.length) {
        // Layer was completed before the end of the buffer, there is buffer left over for someone else to use
        return buffer.subarray(bufferPos);
    } else {
        // Buffer exhausted
        return null;
    }
};

/**
 *
 * @param {CPGreyBmp} mask - The destination to decode pixels into, must already be the correct size.
 * @constructor
 */
function CPMaskDecoder(mask) {
    this.bytesRead = 0;
    this.bytesTotal = mask.width * mask.height;
    this.output = mask.data;
    this.done = true;
}

/**
 * Read 8-bit greyscale pixels from the given buffer into destination pixel array.
 *
 * Returns the buffer with the read bytes removed from the front, or null if the buffer was read in its entirety.
 *
 * @param {Uint8Array} buffer
 */
CPMaskDecoder.prototype.decode = function(buffer) {
    if (buffer == null) {
        return null;
    }

    var
    // How many more pixels are we to read in this buffer?
        bytesRemain = Math.min(buffer.length, this.bytesTotal - this.bytesRead) | 0,
        dstIndex = this.bytesRead;

    for (var srcIndex = 0; srcIndex < bytesRemain; srcIndex++, dstIndex++) {
        this.output[dstIndex] = buffer[srcIndex];
    }

    this.bytesRead = dstIndex;

    if (this.bytesRead >= this.bytesTotal) {
        this.done = true;
    }

    if (dstIndex < buffer.length) {
        // Layer was completed before the end of the buffer, there is buffer left over for someone else to use
        return buffer.subarray(dstIndex);
    } else {
        // Buffer exhausted
        return null;
    }
};

export default function CPChibiFile() {
    const
        MAX_SUPPORTED_MAJOR_VERSION = 1,
        MAX_SUPPORTED_MINOR_VERSION = 1,
        CURRENT_VERSION_NUMBER = (MAX_SUPPORTED_MAJOR_VERSION << 16) | MAX_SUPPORTED_MINOR_VERSION;

    const
        CHI_MAGIC = "CHIBIOEK",

        CHUNK_TAG_HEAD = "HEAD",
        CHUNK_TAG_LAYER = "LAYR",
        CHUNK_TAG_GROUP = "GRUP",
        CHUNK_TAG_END = "ZEND";

    function writeChunkHeader(stream, tag, chunkSize) {
        stream.writeString(tag);
        stream.writeU32BE(chunkSize);
    }

	/**
     * Allocate a fixed-size buffer to represent the chunk with the given tag and size, and return a stream which
     * points to the body of the chunk (with the chunk header already written).
     *
     * @param {string} chunkTag
     * @param {int} chunkBodySize
     * @returns {ArrayDataStream}
     */
    function allocateChunkStream(chunkTag, chunkBodySize) {
        var
            buffer = new Uint8Array(ChibiChunkHeader.HEADER_LENGTH + chunkBodySize),
            stream = new ArrayDataStream(buffer);

        writeChunkHeader(stream, chunkTag, chunkBodySize);

        return stream;
    }

	/**
     *
     * @param {CPArtwork} artwork
     * @param {int} numLayers
     *
     * @returns Uint8Array
     */
    function serializeFileHeaderChunk(artwork, numLayers) {
        var
            stream = allocateChunkStream(CHUNK_TAG_HEAD, CPChibiFileHeader.FIXED_HEADER_LENGTH);

        // Current Version, with Major in the top word and Minor in the lower
        stream.writeU32BE(CURRENT_VERSION_NUMBER);
        stream.writeU32BE(artwork.width);
        stream.writeU32BE(artwork.height);
        stream.writeU32BE(numLayers);

        return stream.getAsDataArray();
    }

    /**
     * @returns Uint8Array
     */
    function serializeEndChunk() {
        return allocateChunkStream(CHUNK_TAG_END, 0).getAsDataArray();
    }
    
	/**
     * Serialize an image layer's header and image data into a byte array buffer, and return it.
     *
     * @param {CPImageLayer} layer
     * @returns {Uint8Array}
     */
    function serializeImageLayerChunk(layer) {
        var
            FIXED_HEADER_LENGTH = 4 * 5,
            stream = allocateChunkStream(CHUNK_TAG_LAYER, FIXED_HEADER_LENGTH + layer.name.length + layer.image.data.length + (layer.mask ? layer.mask.data.length : 0));

        // Fixed length header portion
        stream.writeU32BE(FIXED_HEADER_LENGTH + layer.name.length); // Offset to layer data from start of header

        stream.writeU32BE(layer.blendMode);
        stream.writeU32BE(layer.alpha);
        
        var layerFlags = 0;
        
        if (layer.visible) {
            layerFlags |= LAYER_FLAG_VISIBLE;
        }
        if (layer.clip) {
            layerFlags |= LAYER_FLAG_CLIP;
        }
        if (layer.mask) {
            layerFlags |= LAYER_FLAG_HAS_MASK;
        }
        
        stream.writeU32BE(layerFlags);
        stream.writeU32BE(layer.name.length);

        // Variable length header portion
        stream.writeString(layer.name);

        // Payload data
        writeColorBitmapToStream(stream, layer.image);

        if (layer.mask) {
            writeMaskToStream(stream, layer.mask);
        }

        return stream.getAsDataArray();
    }

    /**
     * Serialize a layer group into a byte array buffer, and return it.
     *
     * @param {CPLayerGroup} group
     * @returns {Uint8Array}
     */
    function serializeLayerGroupChunk(group) {
        const
            FIXED_HEADER_LENGTH = 4 * 6,
            stream = allocateChunkStream(CHUNK_TAG_GROUP, FIXED_HEADER_LENGTH + group.name.length + (group.mask ? group.mask.data.length : 0));

        // Fixed-length header portion

        // Offset to payload data from start of chunk
        stream.writeU32BE(FIXED_HEADER_LENGTH + group.name.length);

        stream.writeU32BE(group.blendMode);
        stream.writeU32BE(group.alpha);

        var groupFlags = 0;

        if (group.visible) {
            groupFlags |= LAYER_FLAG_VISIBLE;
        }
        if (group.mask) {
            groupFlags |= LAYER_FLAG_HAS_MASK;
        }
        if (group.expanded) {
            groupFlags |= LAYER_FLAG_EXPANDED;
        }

        stream.writeU32BE(groupFlags);
        stream.writeU32BE(group.name.length);
        stream.writeU32BE(group.layers.length);

        // Variable-length header portion
        stream.writeString(group.name);

        // Payload data
        if (group.mask) {
            writeMaskToStream(stream, group.mask);
        }

        return stream.getAsDataArray();
    }

    /**
     * Serialize the given artwork to Chibifile format. Returns a promise which resolves to the serialized Blob.
     *
     * @param {CPArtwork} artwork
     */
    this.serialize = function(artwork) {
        return new Promise(function(resolve) {
            var
                deflator = new window.pako.Deflate({
                    level: 7
                }),
                blobParts = [],
                magic = new Uint8Array(CHI_MAGIC.length),
                layers = artwork.getLayersRoot().getLinearizedLayerList(false),
                layerWritePromise = Promise.resolve();
    
            // The magic file signature is not ZLIB compressed:
            for (let i = 0; i < CHI_MAGIC.length; i++) {
                magic[i] = CHI_MAGIC.charCodeAt(i);
            }
            blobParts.push(magic);
    
            // The rest gets compressed
            deflator.push(serializeFileHeaderChunk(artwork, layers.length), false);
    
            for (let layer of layers) {
                layerWritePromise = layerWritePromise.then(() => new Promise(function(resolve) {
                    if (layer instanceof CPImageLayer) {
                        deflator.push(serializeImageLayerChunk(layer), false);
                    } else if (layer instanceof CPLayerGroup) {
                        deflator.push(serializeLayerGroupChunk(layer), false);
                    }

                    // Insert a setTimeout between each serialized layer, so we can maintain browser responsiveness
                    setTimeout(resolve, 10);
                }));
            }

            layerWritePromise.then(function() {
                deflator.push(serializeEndChunk(), true);

                blobParts.push(deflator.result);

                resolve(new Blob(blobParts, {type: "application/octet-stream"}));
            });
        });
    };

    function hasChibiMagicMarker(array) {
        for (var i = 0; i < CHI_MAGIC.length; i++) {
            if (array[i] != CHI_MAGIC.charCodeAt(i)) {
                return false;
            }
        }

        return true;
    }
    
    /**
     * Attempt to load a chibifile from the given arraybuffer.
     *
     * @returns A CPArtwork on success, or null on failure.
     */
    this.read = function(arrayBuffer) {
        const
            STATE_WAIT_FOR_CHUNK               = 0,

            STATE_DECODE_FILE_HEADER           = 1,

            STATE_DECODE_LAYER                 = 2,
            STATE_DECODE_GROUP                 = 3,

            STATE_SUCCESS                      = 45,
            STATE_FATAL                        = 5;
        
        var
            pako = new window.pako.Inflate({}),
            state = STATE_WAIT_FOR_CHUNK,

	        /**
             * Destination artwork
             *
             * @type {CPArtwork}
             */
            artwork = null,

	        /**
             * Group we're currently loading layers into
             *
             * @type {CPLayerGroup}
             */
            destGroup = null,

            /**
             * Decoder we're currently using to read a layer.
             *
             * @type {ChibiLayerDecoder}
             */
            layerDecoder,

	        /**
             * Number of bytes we should skip in the stream before resuming decoding.
             *
	         * @type {int}
             */
            skipCount = 0,

	        /**
	         * The overall file descriptor
             *
             * @type {CPChibiFileHeader}
             */
            fileHeader = null,

	        /**
             *
             * @type {ChibiChunkHeader}
             */
            curChunkHeader = null,

	        /**
             * Here we store data that we weren't able to process in previous iterations due to not enough
             * data being available at once.
             *
             * @type {Uint8Array}
             */
            accumulator = null;

	    /**
         * Called by the Pako Zlib decompressor each time a block of data is ready for processing.
         *
         * @param {Uint8Array} block
         */
        function processBlock(block) {
            var 
                stream;

            accumulator = concatBuffers(accumulator, block);
            block = null;

            // Add a loop here so we can re-enter the switch with 'continue'
            while (true) {
                if (accumulator) {
                    if (skipCount < accumulator.length) {
                        accumulator = accumulator.subarray(skipCount);
                        skipCount = 0;
                    } else {
                        skipCount -= accumulator.length;
                        accumulator = null;
                        break;
                    }
                } else {
                    break;
                }

                // Decode some data from the accumulator
                switch (state) {
                    case STATE_WAIT_FOR_CHUNK:
                        // Wait for whole chunk header to become available
                        if (accumulator.length < ChibiChunkHeader.HEADER_LENGTH) {
                            break;
                        }
                        
                        // Decode chunk header
                        stream = new ArrayDataStream(accumulator);
                        curChunkHeader = new ChibiChunkHeader(stream);
                        
                        // Remove the chunk header from the start of the accumulator
                        accumulator = accumulator.subarray(stream.pos);
                        
                        if (fileHeader) {
                            if (curChunkHeader.chunkType == CHUNK_TAG_END) {
                                state = STATE_SUCCESS;
                            } else if (curChunkHeader.chunkType == CHUNK_TAG_LAYER) {
                                state = STATE_DECODE_LAYER;
                                layerDecoder = new ChibiImageLayerDecoder(curChunkHeader, fileHeader.width, fileHeader.height);
                                continue;
                            } else if (curChunkHeader.chunkType == CHUNK_TAG_GROUP) {
                                state = STATE_DECODE_GROUP;
                                layerDecoder = new ChibiLayerGroupDecoder(curChunkHeader, fileHeader.width, fileHeader.height);
                                continue;
                            } else {
                                console.log("Unknown chunk type '" + curChunkHeader.chunkType + "', attempting to skip...");

                                skipCount = curChunkHeader.chunkSize;
                                continue;
                            }
                        } else if (curChunkHeader.chunkType == CHUNK_TAG_HEAD) {
                            state = STATE_DECODE_FILE_HEADER;
                            continue;
                        } else {
                            // File didn't start with image header chunk
                            state = STATE_FATAL;
                        }
                        break;

                    case STATE_DECODE_FILE_HEADER:
                        // Wait for whole chunk to be available
                        if (accumulator.length < curChunkHeader.chunkSize) {
                            break;
                        }
                        
                        stream = new ArrayDataStream(accumulator);
                        fileHeader = new CPChibiFileHeader(stream);
                        
                        if ((fileHeader.version >>> 16) > MAX_SUPPORTED_MAJOR_VERSION) {
                            state = STATE_FATAL; // the file version is higher than what we can deal with, bail out
                            break;
                        }
                        
                        artwork = new CPArtwork(fileHeader.width, fileHeader.height);
                        destGroup = artwork.getLayersRoot();

                        // Skip the header chunk along with any trailing bytes
                        skipCount = curChunkHeader.chunkSize;
                        state = STATE_WAIT_FOR_CHUNK;
                        continue;

                    case STATE_DECODE_LAYER:
                        accumulator = layerDecoder.decode(accumulator);

                        if (layerDecoder.done) {
                            artwork.addLayerObject(destGroup, layerDecoder.layer);
                            state = STATE_WAIT_FOR_CHUNK;
                            continue;
                        }
                        break;

                    case STATE_DECODE_GROUP:
                        accumulator = layerDecoder.decode(accumulator);

                        if (layerDecoder.done) {
                            artwork.addLayerGroupObject(destGroup, layerDecoder.layer, layerDecoder.childLayers);

                            state = STATE_WAIT_FOR_CHUNK;
                            continue;
                        }
                        break;
                }
                
                break;
            }
        }
        
        arrayBuffer = new Uint8Array(arrayBuffer);

        if (!hasChibiMagicMarker(arrayBuffer)) {
            return null; // not a ChibiPaint file
        }
        
        // Remove the magic header
        arrayBuffer = arrayBuffer.subarray(CHI_MAGIC.length);
        
        pako.onData = processBlock;
        
        pako.onEnd = function(status) {
            if (status === 0 && state == STATE_SUCCESS) {
                artwork.selectTopmostVisibleLayer();
                
                this.result = artwork;
            } else {
                console.log("Fatal error decoding ChibiFile");
                
                this.result = null;
            }
        };

        // Begin decompression/decoding
        pako.push(arrayBuffer);
        
        return pako.result;
    };
}
