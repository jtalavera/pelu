import { useTranslation } from "react-i18next";
import { Card, Heading, Text } from "@design-system";

export default function PlaceholderPage() {
  const { t } = useTranslation();
  return (
    <Card className="max-w-lg p-6">
      <Heading as="h1" className="mb-2">
        {t("femme.placeholder.title")}
      </Heading>
      <Text>{t("femme.placeholder.body")}</Text>
    </Card>
  );
}
