// @flow

import type Parser from "../../parser";
import type { ExpressionErrors } from "../../parser/util";
import { types as tt } from "../../tokenizer/types";
import * as N from "../../types";
import type { Position } from "../../util/location";

function isFragment(object: ?N.JSXElement): boolean {
  return object ? object.type === "JSXOpeningFragment" : false;
}

export default (superClass: Class<Parser>): Class<Parser> =>
  class extends superClass {
    // Parse next token as DUI identifier

    duiParseIdentifier(): N.JSXIdentifier {
      const node = this.startNode();
      if (this.match(tt.name)) {
        node.name = this.state.value;
      } else if (this.state.type.keyword) {
        node.name = this.state.type.keyword;
      } else {
        this.unexpected();
      }
      this.next();
      return this.finishNode(node, "JSXIdentifier");
    }

    // Parse namespaced identifier.

    duiParseNamespacedName(): N.JSXNamespacedName {
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      const name = this.duiParseIdentifier();
      if (!this.eat(tt.slash)) return name;

      const node = this.startNodeAt(startPos, startLoc);
      node.namespace = name;
      node.name = this.duiParseIdentifier();
      return this.finishNode(node, "JSXNamespacedName");
    }

    // Parses element name in any form - namespaced, member
    // or single identifier.

    duiParseElementName():
      | N.JSXIdentifier
      | N.JSXNamespacedName
      | N.JSXMemberExpression {
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      let node = this.duiParseNamespacedName();
      if (node.type === "JSXNamespacedName") {
        return node;
      }
      while (this.eat(tt.dot)) {
        const newNode = this.startNodeAt(startPos, startLoc);
        newNode.object = node;
        newNode.property = this.duiParseIdentifier();
        node = this.finishNode(newNode, "JSXMemberExpression");
      }
      return node;
    }

    // DUIEmptyExpression is unique type since it doesn't actually parse anything,
    // and so it should start at the end of last read token (left brace) and finish
    // at the beginning of the next one (right brace).

    duiParseEmptyExpression(): N.JSXEmptyExpression {
      const node = this.startNodeAt(
        this.state.lastTokEnd,
        this.state.lastTokEndLoc,
      );
      return this.finishNodeAt(
        node,
        "JSXEmptyExpression",
        this.state.start,
        this.state.startLoc,
      );
    }

    // Parse DUI spread child

    duiParseSpreadChild(node: N.JSXSpreadChild): N.JSXSpreadChild {
      this.next(); // ellipsis
      node.expression = this.parseExpression();
      this.expect(tt.braceR);

      return this.finishNode(node, "JSXSpreadChild");
    }

    // Parses DUI expression enclosed into curly brackets.

    duiParseExpressionContainer(
      node: N.JSXExpressionContainer,
    ): N.JSXExpressionContainer {
      if (this.match(tt.braceR)) {
        node.expression = this.duiParseEmptyExpression();
      } else {
        node.expression = this.parseExpression();
      }
      this.expect(tt.braceR);
      return this.finishNode(node, "JSXExpressionContainer");
    }

    // Parses following DUI attribute name-value pair.

    duiParseAttribute(): N.JSXAttribute {
      const node = this.startNode();
      if (this.eat(tt.ellipsis)) {
        node.argument = this.parseMaybeAssign();
        return this.finishNode(node, "JSXSpreadAttribute");
      }
      node.name = this.duiParseNamespacedName();
      node.value = this.eat(tt.colon) ? this.parseMaybeAssign() : null;
      return this.finishNode(node, "JSXAttribute");
    }

    // Parses DUI opening tag starting after "tag {".

    duiParseOpeningElementAt(
      startPos: number,
      startLoc: Position,
    ): N.JSXOpeningElement {
      const node = this.startNodeAt(startPos, startLoc);
      if (this.match(tt.at)) {
        this.expect(tt.at);
        this.expect(tt.braceL);
        return this.finishNode(node, "JSXOpeningFragment");
      }
      node.name = this.duiParseElementName();
      return this.duiParseOpeningElementAfterName(node);
    }

    duiParseOpeningElementAfterName(
      node: N.JSXOpeningElement,
    ): N.JSXOpeningElement {
      const attributes: N.JSXAttribute[] = [];

      if (this.match(tt.parenL)) {
        this.next();
        let first = true;
        while (!this.match(tt.parenR)) {
          if (!first) {
            this.expect(tt.comma);
          }

          attributes.push(this.duiParseAttribute());
          first = false;
        }
        node.selfClosing = false; //this.eat(tt.slash);
        this.expect(tt.parenR);
      }

      node.attributes = attributes;
      this.expect(tt.braceL);
      return this.finishNode(node, "JSXOpeningElement");
    }

    // Parses entire DUI element, including it"s opening
    // ("tag {"), attributes, contents and closing "}".

    duiParseElementAt(startPos: number, startLoc: Position): N.JSXElement {
      const node = this.startNodeAt(startPos, startLoc);
      const children = [];
      const openingElement = this.duiParseOpeningElementAt(startPos, startLoc);

      if (!openingElement.selfClosing) {
        while (!this.eat(tt.braceR)) {
          children.push(this.parseMaybeAssign());
        }
      }

      if (isFragment(openingElement)) {
        node.openingFragment = openingElement;
      } else {
        node.openingElement = openingElement;
      }

      node.openingElement = openingElement;
      node.children = children;

      return isFragment(openingElement)
        ? this.finishNode(node, "JSXFragment")
        : this.finishNode(node, "JSXElement");
    }

    // Parses entire DUI element from current position.

    duiParseElement(): N.JSXElement {
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      return this.duiParseElementAt(startPos, startLoc);
    }

    duiCheckElement() {
      if (!this.match(tt.name) && !this.match(tt.at)) return false;

      const old = this.state;
      this.state = old.clone(true);
      this.isLookahead = true;

      let isPossibleElement = true;

      try {
        this.duiParseOpeningElementAt(this.state.start, this.state.startLoc);
      } catch {
        isPossibleElement = false;
      }

      this.isLookahead = false;
      this.state = old;

      return isPossibleElement;
    }

    // ==================================
    // Overrides
    // ==================================

    parseExprAtom(refExpressionErrors: ?ExpressionErrors): N.Expression {
      if (this.duiCheckElement()) {
        return this.duiParseElement();
      }

      return super.parseExprAtom(refExpressionErrors);
    }
  };
