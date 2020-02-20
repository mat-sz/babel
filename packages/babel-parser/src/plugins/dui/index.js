// @flow

import * as charCodes from "charcodes";

import type Parser from "../../parser";
import type { ExpressionErrors } from "../../parser/util";
import { types as tt } from "../../tokenizer/types";
import * as N from "../../types";
import type { Position } from "../../util/location";

// function isFragment(object: ?N.DUIElement): boolean {
//   return object ? object.type === "JSXOpeningFragment" : false;
// }

export default (superClass: Class<Parser>): Class<Parser> =>
  class extends superClass {
    // Parse next token as DUI identifier

    duiParseIdentifier(): N.DUIIdentifier {
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

    duiParseNamespacedName(): N.DUINamespacedName {
      // const startPos = this.state.start;
      // const startLoc = this.state.startLoc;
      const name = this.duiParseIdentifier();
      //if (!this.eat(tt.colon)) return name;
      return name;

      // const node = this.startNodeAt(startPos, startLoc);
      // node.namespace = name;
      // node.name = this.duiParseIdentifier();
      // return this.finishNode(node, "JSXNamespacedName");
    }

    // Parses element name in any form - namespaced, member
    // or single identifier.

    duiParseElementName():
      | N.DUIIdentifier
      | N.DUINamespacedName
      | N.DUIMemberExpression {
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

    duiParseEmptyExpression(): N.DUIEmptyExpression {
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

    duiParseSpreadChild(node: N.DUISpreadChild): N.DUISpreadChild {
      this.next(); // ellipsis
      node.expression = this.parseExpression();
      this.expect(tt.braceR);

      return this.finishNode(node, "JSXSpreadChild");
    }

    // Parses DUI expression enclosed into curly brackets.

    duiParseExpressionContainer(
      node: N.DUIExpressionContainer,
    ): N.DUIExpressionContainer {
      if (this.match(tt.braceR)) {
        node.expression = this.duiParseEmptyExpression();
      } else {
        node.expression = this.parseExpression();
      }
      this.expect(tt.braceR);
      return this.finishNode(node, "JSXExpressionContainer");
    }

    // Parses following DUI attribute name-value pair.

    duiParseAttribute(): N.DUIAttribute {
      const node = this.startNode();
      if (this.eat(tt.braceL)) {
        this.expect(tt.ellipsis);
        node.argument = this.parseMaybeAssign();
        this.expect(tt.braceR);
        return this.finishNode(node, "JSXSpreadAttribute");
      }
      node.name = this.duiParseNamespacedName();
      node.value = this.eat(tt.colon) ? this.parseExprAtom() : null;
      return this.finishNode(node, "JSXAttribute");
    }

    // Parses DUI opening tag starting after "tag {".

    duiParseOpeningElementAt(
      startPos: number,
      startLoc: Position,
    ): N.DUIOpeningElement {
      const node = this.startNodeAt(startPos, startLoc);
      node.name = this.duiParseElementName();
      return this.duiParseOpeningElementAfterName(node);
    }

    duiParseOpeningElementAfterName(
      node: N.DUIOpeningElement,
    ): N.DUIOpeningElement {
      if (this.match(tt.parenL)) {
        this.next();
        const attributes: N.DUIAttribute[] = [];
        let first = true;
        while (!this.match(tt.parenR)) {
          if (!first) {
            this.expect(tt.comma);
          }

          attributes.push(this.duiParseAttribute());
          first = false;
        }
        node.attributes = attributes;
        //node.selfClosing = this.eat(tt.slash);
        this.expect(tt.parenR);
      }
      this.nextToken();
      return this.finishNode(node, "JSXOpeningElement");
    }

    // Parses entire DUI element, including it"s opening
    // ("tag {"), attributes, contents and closing "}".

    duiParseElementAt(startPos: number, startLoc: Position): N.DUIElement {
      const node = this.startNodeAt(startPos, startLoc);
      const children = [];
      const openingElement = this.duiParseOpeningElementAt(startPos, startLoc);

      if (!openingElement.selfClosing) {
        contents: for (;;) {
          switch (this.state.type) {
            case tt.braceR:
              this.next();
              break contents;

            case tt.string:
            case tt.name:
              children.push(this.parseExprAtom());
              break;

            case tt.braceL: {
              const node = this.startNode();
              this.next();
              if (this.match(tt.ellipsis)) {
                children.push(this.duiParseSpreadChild(node));
              } else {
                children.push(this.duiParseExpressionContainer(node));
              }

              break;
            }
            // istanbul ignore next - should never happen
            default:
              throw this.unexpected();
          }
        }
      }

      // if (isFragment(openingElement)) {
      //   node.openingFragment = openingElement;
      // } else {
      //   node.openingElement = openingElement;
      // }

      node.openingElement = openingElement;
      node.children = children;

      // if (this.isRelational("<")) {
      //   throw this.raise(
      //     this.state.start,
      //     "Adjacent DUI elements must be wrapped in an enclosing tag.",
      //   );
      // }

      return this.finishNode(node, "JSXElement");

      // return isFragment(openingElement)
      //   ? this.finishNode(node, "JSXFragment")
      //   : this.finishNode(node, "JSXElement");
    }

    // Parses entire DUI element from current position.

    duiParseElement(): N.DUIElement {
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      return this.duiParseElementAt(startPos, startLoc);
    }

    // ==================================
    // Overrides
    // ==================================

    parseExprAtom(refExpressionErrors: ?ExpressionErrors): N.Expression {
      if (
        this.match(tt.name) &&
        (this.lookaheadCharCode() === charCodes.leftCurlyBrace ||
          this.lookaheadCharCode() === charCodes.leftParenthesis)
      ) {
        return this.duiParseElement();
      } else {
        return super.parseExprAtom(refExpressionErrors);
      }
    }
  };
