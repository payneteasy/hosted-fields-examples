/**
 * The Hosted Fields example.
 *
 * <p>{@code @NullMarked} turns on NullAway for everything in here: a reference is non-null unless
 * it says otherwise, and the {@code errorprone} profile fails the build on a violation. The
 * annotation is written out in full rather than imported, so Spotless's {@code removeUnusedImports}
 * cannot take it away.
 */
@org.jspecify.annotations.NullMarked
package com.payneteasy.hostedfields;
