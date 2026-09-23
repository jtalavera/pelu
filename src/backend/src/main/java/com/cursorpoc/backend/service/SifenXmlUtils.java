package com.cursorpoc.backend.service;

import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/**
 * Shared helpers for reading SIFEN SOAP response bodies by local element name, ignoring namespace
 * prefixes — both {@link SifenDocumentReceptionClient} (HU-06) and {@link SifenDocumentQueryClient}
 * (HU-07) parse response shapes where the exact prefix isn't worth asserting on (verified live to
 * vary: {@code ns2:}, {@code env:}, etc.).
 */
final class SifenXmlUtils {

  private SifenXmlUtils() {}

  static Element firstDescendant(Element scope, String localName) {
    NodeList nodes = scope.getElementsByTagNameNS("*", localName);
    return nodes.getLength() == 0 ? null : (Element) nodes.item(0);
  }

  static String firstDescendantText(Element scope, String localName) {
    Element element = firstDescendant(scope, localName);
    if (element == null) {
      return null;
    }
    Node firstChild = element.getFirstChild();
    return firstChild == null ? null : element.getTextContent().trim();
  }
}
