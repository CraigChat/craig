-- CreateTable
CREATE TABLE "MicrosoftUser" (
    "id" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,

    CONSTRAINT "MicrosoftUser_pkey" PRIMARY KEY ("id")
);
