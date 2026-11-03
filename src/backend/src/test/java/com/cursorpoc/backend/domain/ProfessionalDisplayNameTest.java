package com.cursorpoc.backend.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ProfessionalDisplayNameTest {

  private static Professional professional(String fullName, String nickname) {
    Professional p = new Professional();
    p.setFullName(fullName);
    p.setNickname(nickname);
    return p;
  }

  @Test
  void showsTheNicknameWhenThereIsOne() {
    assertThat(professional("ANA MARIA CACERES", "Ani").getDisplayName()).isEqualTo("Ani");
  }

  @Test
  void fallsBackToTheFullNameWithoutNickname() {
    assertThat(professional("ANA MARIA CACERES", null).getDisplayName())
        .isEqualTo("ANA MARIA CACERES");
    assertThat(professional("ANA MARIA CACERES", "  ").getDisplayName())
        .isEqualTo("ANA MARIA CACERES");
  }
}
