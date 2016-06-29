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

import CPRect from "../js/util/CPRect.js";

import assert from "assert";

import Random from "random-js";

/**
 * Get an array of randomly generated rectangles, of maximum length 20 units (width or height).
 *
 * @param {int} numRects
 * @param {int} maxRight
 * @param {int} maxBottom
 * @param {Random} random
 * @returns {CPRect[]}
 */
function makeRandomRects(numRects, maxRight, maxBottom, random) {
	const
		MAX_RADIUS = 20;

	var
		result = new Array(numRects);

	for (let i = 0; i < numRects; i++) {
		var
			left = random.integer(0, maxRight),
			top = random.integer(0, maxBottom),
			width = Math.min(left + random.integer(0, MAX_RADIUS), maxRight - left),
			height = Math.min(top + random.integer(0, MAX_RADIUS), maxBottom - top);

		result[i] = new CPRect(left, top, left + width, top + height);
	}

	return result;
}

/**
 * Render the rectangles out into an array with 1 for areas where the rects are present and 0 elsewhere.
 *
 * @param {CPRect[]} rects
 * @param {int} width
 * @param {int} height
 * @returns Uint8Array
 */
function renderRectsAtBitmap(rects, width, height) {
	var
		result = new Uint8Array(width * height);

	for (let rect of rects) {
		for (let y = rect.top; y < rect.bottom; y++) {
			for (let x = rect.left; x < rect.right; x++) {
				result[y * width + x] = 1;
			}
		}
	}

	return result;
}

/**
 * Return a bitmap which is b1, but with zero wherever b2 is one.
 *
 * @param b1
 * @param b2
 * @returns {Uint8Array}
 */
function subtractBitmaps(b1, b2) {
	var
		result = new Uint8Array(b1.length);

	for (let i = 0; i < b1.length; i++) {
		result[i] = b2[i] == 1 ? 0 : b1[i];
	}

	return result;
}

function areBitmapsEqual(b1, b2) {
	if (b1.length != b2.length) {
		return false;
	}

	for (let i = 0; i < b1.length; i++) {
		if (b1[i] != b2[i]) {
			return false;
		}
	}

	return true;
}

function printBitmap(bitmap, width, height) {
	for (let y = 0; y < height; y++) {
		let line = "";

		for (let x = 0; x < width; x++) {
			line += bitmap[y * width + x] ? "O" : ".";
		}

		console.log(line);
	}
	console.log("");
}

function testSubtractFull(seed) {
	const
		NUM_TEST_RECTS = 80,
		TEST_AREA_SIZE = 400;

	let
		engine = Random.engines.mt19937();

	if (seed === undefined) {
		engine.autoSeed();
	} else {
		engine.seed(seed);
	}

	let
		random = new Random(engine),

		setA = makeRandomRects(NUM_TEST_RECTS, TEST_AREA_SIZE, TEST_AREA_SIZE, random),
		setB = makeRandomRects(NUM_TEST_RECTS, TEST_AREA_SIZE, TEST_AREA_SIZE, random),
		setASubB = CPRect.subtract(setA, setB),

	// Compare our rectangle subtraction against a bitmap-based one
		imageA = renderRectsAtBitmap(setA, TEST_AREA_SIZE, TEST_AREA_SIZE),
		imageB = renderRectsAtBitmap(setB, TEST_AREA_SIZE, TEST_AREA_SIZE),

		imageASubB = subtractBitmaps(imageA, imageB),
		setASubBAsImage = renderRectsAtBitmap(setASubB, TEST_AREA_SIZE, TEST_AREA_SIZE);

	if (!areBitmapsEqual(imageASubB, setASubBAsImage)) {
		throw Error(`Subtraction result incorrect (seed ${seed})`);
	}
}

/**
 * Breaks at the first problem and prints the rectangles involved.
 */
function testSubtractIterative(seed) {
	const
		NUM_TEST_RECTS = 20,
		TEST_AREA_WIDTH = 120,
		TEST_AREA_HEIGHT = 40;

	let
		setA = [],
		setB = [],

		engine = Random.engines.mt19937();

	if (seed === undefined) {
		engine.autoSeed();
	} else {
		engine.seed(seed);
	}

	let
		random = new Random(engine);

	for (let i = 0; i < NUM_TEST_RECTS; i++) {
		var
			newARect = makeRandomRects(1, TEST_AREA_WIDTH, TEST_AREA_HEIGHT, random),
			newBRect = makeRandomRects(1, TEST_AREA_WIDTH, TEST_AREA_HEIGHT, random);

		setA = setA.concat(newARect);
		setB = setB.concat(newBRect);

		let
			setASubB = CPRect.subtract(setA, setB),

		// Compare our rectangle subtraction against a bitmap-based one
			imageA = renderRectsAtBitmap(setA, TEST_AREA_WIDTH, TEST_AREA_HEIGHT),
			imageB = renderRectsAtBitmap(setB, TEST_AREA_WIDTH, TEST_AREA_HEIGHT),

			rectSubResult = renderRectsAtBitmap(setASubB, TEST_AREA_WIDTH, TEST_AREA_HEIGHT),
			bitmapResult = subtractBitmaps(imageA, imageB);

		if (!areBitmapsEqual(bitmapResult, rectSubResult)) {
			console.log("\nRectangles A:");
			console.log(setA);
			console.log("\nMinus rectangles B:");
			console.log(setB);
			console.log("\nEquals:");
			console.log(setASubB);

			console.log("\nRectangles A:");
			printBitmap(imageA, TEST_AREA_WIDTH, TEST_AREA_HEIGHT);
			console.log("Minus rectangles B:");
			printBitmap(imageB, TEST_AREA_WIDTH, TEST_AREA_HEIGHT);
			console.log("Equals (CPRect.subtract):");
			printBitmap(rectSubResult, TEST_AREA_WIDTH, TEST_AREA_HEIGHT);
			console.log("Equals (bitmap reference):");
			printBitmap(bitmapResult, TEST_AREA_WIDTH, TEST_AREA_HEIGHT);

			throw Error(`Subtraction result incorrect (seed ${seed})`);
		}
	}
}

describe("CPRect", function() {
	describe("#subtract", function() {
		it("should give the same results as bitmap subtraction under a randomized testing regime", function() {
			testSubtractFull();
		});
	});

	describe("#clipSourceDest", function() {
		it("should set the width and height of the destination rect", function() {
			var
				container = new CPRect(0, 0, 100, 100),
				srcRect = new CPRect(0, 0, 10, 10),
				dstRect = new CPRect(10, 10, 0, 0);

			container.clipSourceDest(srcRect, dstRect);

			assert(dstRect.left == 10);
			assert(dstRect.top == 10);
			assert(dstRect.right == 20);
			assert(dstRect.bottom == 20);
		});

		it("should clip if the dest rectangle partially leaves the top left", function() {
			var
				container = new CPRect(0, 0, 100, 100),
				srcRect = new CPRect(0, 0, 10, 10),
				dstRect = new CPRect(-5, -5, 0, 0);

			container.clipSourceDest(srcRect, dstRect);

			assert(srcRect.left == 5);
			assert(srcRect.top == 5);
			assert(srcRect.right == 10);
			assert(srcRect.bottom == 10);

			assert(dstRect.left == 0);
			assert(dstRect.top == 0);
			assert(dstRect.right == 5);
			assert(dstRect.bottom == 5);
		});

		it("should clip if the dest rectangle partially leaves the bottom right", function() {
			var
				container = new CPRect(0, 0, 100, 100),
				srcRect = new CPRect(0, 0, 10, 10),
				dstRect = new CPRect(95, 95, 0, 0);

			container.clipSourceDest(srcRect, dstRect);

			assert(srcRect.left == 0);
			assert(srcRect.top == 0);
			assert(srcRect.right == 5);
			assert(srcRect.bottom == 5);

			assert(dstRect.left == 95);
			assert(dstRect.top == 95);
			assert(dstRect.right == 100);
			assert(dstRect.bottom == 100);
		});

		it("should return an empty rectangle if the dest leaves the top left", function() {
			var
				container = new CPRect(0, 0, 100, 100),
				srcRect = new CPRect(0, 0, 10, 10),
				dstRect = new CPRect(-10, -10, 0, 0);

			container.clipSourceDest(srcRect, dstRect);

			assert(srcRect.isEmpty());
			assert(dstRect.isEmpty());

			assert(container.equals(new CPRect(0, 0, 100, 100)));
		});

		it("should return an empty rectangle if the dest leaves the bottom right", function() {
			var
				container = new CPRect(0, 0, 100, 100),
				srcRect = new CPRect(0, 0, 10, 10),
				dstRect = new CPRect(100, 100, 0, 0);

			container.clipSourceDest(srcRect, dstRect);

			assert(srcRect.isEmpty());
			assert(dstRect.isEmpty());

			assert(container.equals(new CPRect(0, 0, 100, 100)));
		});
	});
});
